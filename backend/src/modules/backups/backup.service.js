import crypto from "node:crypto";
import { Readable } from "node:stream";
import { gzipSync, gunzipSync } from "node:zlib";
// Both from db.js: restore order is computed from the schema, and it has to be
// the schema of the client the rows are read and written through.
import db, { Prisma } from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { addJob, isQueueEnabled } from "../../lib/queue.js";
import {
  deleteObject,
  getObject,
  putObject,
} from "../../lib/objectStorage.js";
import { JOB_NAMES, QUEUE_NAMES } from "../../workers/queueNames.js";
import { createAuditLog } from "../audit/audit.service.js";
import {
  CREDENTIAL_FIELDS_ALWAYS_PRESERVED,
  PRESERVED_SHOP_MODELS,
  RESTORABLE_CHILD_MODELS,
  RESTORABLE_SHOP_MODELS,
  childWhereForShop,
  prismaDelegateName,
} from "./backup-policy.js";
import { acquireShopMaintenanceLock, releaseShopMaintenanceLock } from "./maintenance-lock.service.js";

const BACKUP_FORMAT = "kiranaos_aes256gcm_gzip_v1";
const BACKUP_SCHEMA_VERSION = "2026-08-27-complete-v6";
const BACKUP_HEADER = Buffer.from("KOSB1", "ascii");
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;
const RESTORE_PRESERVED_AUDIT_ACTIONS = Object.freeze([
  "SHOP_BACKUP_REQUESTED",
  "SHOP_BACKUP_COMPLETED",
  "SHOP_BACKUP_DOWNLOADED",
  "SHOP_BACKUP_RESTORE_PREVIEWED",
  "SHOP_BACKUP_RESTORED",
]);

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, code);
}

async function writeRequiredBackupAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw appError(
      "Backup action was not saved because its audit record could not be stored",
      503,
      "BACKUP_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function encryptionKey() {
  const raw = String(env.BACKUP_ENCRYPTION_KEY || "").trim();
  const decoded = Buffer.from(raw, "base64");
  if (!raw || decoded.length !== 32 || decoded.toString("base64").replace(/=+$/, "") !== raw.replace(/=+$/, "")) {
    throw appError(
      "BACKUP_ENCRYPTION_KEY must be a base64-encoded 32-byte key",
      503,
      "BACKUP_ENCRYPTION_KEY_INVALID",
    );
  }
  return decoded;
}

function assertBackupStorageSafe() {
  encryptionKey();
  if (env.NODE_ENV === "production" && env.STORAGE_PROVIDER === "local") {
    throw appError(
      "Production backups require S3, R2, or MinIO object storage",
      503,
      "BACKUP_STORAGE_NOT_PRODUCTION_SAFE",
    );
  }
}

function backupKey(shopId, artifactId) {
  if (!/^[A-Za-z0-9_-]+$/.test(shopId) || !/^[A-Za-z0-9_-]+$/.test(artifactId)) {
    throw appError("Unsafe backup identifier", 400, "UNSAFE_BACKUP_IDENTIFIER");
  }
  return `backups/shops/${shopId}/${artifactId}.kosb`;
}

function stringifySnapshot(snapshot) {
  return JSON.stringify(snapshot, (_key, value) => (
    typeof value === "bigint" ? { $kiranaosBigInt: value.toString() } : value
  ));
}

function encryptSnapshot(plain, key = encryptionKey()) {
  const compressed = gzipSync(plain, { level: 9 });
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(compressed), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([BACKUP_HEADER, iv, tag, ciphertext]);
}

function decryptSnapshot(encrypted, key = encryptionKey()) {
  const buffer = Buffer.from(encrypted);
  if (!buffer.subarray(0, BACKUP_HEADER.length).equals(BACKUP_HEADER)) {
    throw appError("Backup header is invalid", 400, "BACKUP_FORMAT_INVALID");
  }
  const ivStart = BACKUP_HEADER.length;
  const tagStart = ivStart + 12;
  const bodyStart = tagStart + 16;
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, buffer.subarray(ivStart, tagStart));
  decipher.setAuthTag(buffer.subarray(tagStart, bodyStart));
  return gunzipSync(Buffer.concat([decipher.update(buffer.subarray(bodyStart)), decipher.final()]));
}

function parseSnapshot(plain) {
  try {
    // Keep encoded BigInts as tagged JSON objects during validation. Rehydration
    // into Prisma values belongs to the transactional restore executor; returning
    // actual BigInts here would make previews/logging non-serializable.
    return JSON.parse(Buffer.from(plain).toString("utf8"));
  } catch {
    throw appError("Backup payload is not valid JSON", 400, "BACKUP_PAYLOAD_INVALID");
  }
}

async function loadVerifiedSnapshot(shopId, artifactId) {
  const row = await db.backupArtifact.findFirst({
    where: { id: artifactId, shopId, status: "completed", type: "shop_logical" },
  });
  if (!row?.objectKey) throw appError("Completed backup artifact not found", 404, "BACKUP_ARTIFACT_NOT_FOUND");
  const encrypted = await getObject({ key: row.objectKey });
  const checksum = crypto.createHash("sha256").update(encrypted).digest("hex");
  if (!row.checksumSha256 || checksum !== row.checksumSha256) {
    throw appError("Backup checksum mismatch", 409, "BACKUP_CHECKSUM_MISMATCH");
  }
  let plain;
  try {
    plain = decryptSnapshot(encrypted);
  } catch (error) {
    if (error instanceof AppError) throw error;
    throw appError("Backup authentication or decryption failed", 400, "BACKUP_DECRYPTION_FAILED");
  }
  if (plain.length > MAX_UNCOMPRESSED_BYTES) {
    throw appError("Backup exceeds the 256 MiB logical snapshot limit", 413, "BACKUP_TOO_LARGE");
  }
  return { row, encrypted, snapshot: parseSnapshot(plain) };
}

function countRows(value) {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.length + value.reduce((sum, item) => sum + countNestedArrays(item), 0);
  return Object.values(value).reduce((sum, item) => sum + countRows(item), 0);
}

function countNestedArrays(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((sum, item) => {
    if (Array.isArray(item)) return sum + countRows(item);
    return sum + countNestedArrays(item);
  }, 0);
}

async function buildCompleteShopSnapshot(shopId, client = db) {
  const shop = await client.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw appError("Shop not found", 404, "SHOP_NOT_FOUND");
  const tables = {};
  // Prisma's interactive-transaction client is a proxy. Resolve and await one
  // dynamic delegate at a time; parallel dynamic getters can alias a delegate
  // in the isolated integration client and validate a query against the wrong model.
  for (const modelName of RESTORABLE_SHOP_MODELS) {
    const delegate = client[prismaDelegateName(modelName)];
    if (!delegate?.findMany) throw appError(`Backup delegate missing for ${modelName}`, 500, "BACKUP_MODEL_UNAVAILABLE");
    tables[modelName] = await delegate.findMany({ where: { shopId } });
  }
  for (const [modelName, policy] of Object.entries(RESTORABLE_CHILD_MODELS)) {
    const delegate = client[prismaDelegateName(modelName)];
    if (!delegate?.findMany) throw appError(`Backup child delegate missing for ${modelName}`, 500, "BACKUP_MODEL_UNAVAILABLE");
    tables[modelName] = await delegate.findMany({ where: childWhereForShop(policy.where, shopId) });
  }
  return {
    manifest: {
      product: "KiranaOS", format: BACKUP_FORMAT, schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(), shopId,
      bigintEncoding: "{ $kiranaosBigInt: decimal-string }",
      dataLayout: "flat_prisma_tables_v2",
      restorableModels: [...RESTORABLE_SHOP_MODELS, ...Object.keys(RESTORABLE_CHILD_MODELS)].sort(),
      preservedModels: [...PRESERVED_SHOP_MODELS].sort(),
      credentialsExcluded: [...CREDENTIAL_FIELDS_ALWAYS_PRESERVED],
    },
    data: { shop, tables },
  };
}

function publicArtifact(row) {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    format: row.format,
    storage_provider: row.storageProvider,
    checksum_sha256: row.checksumSha256,
    size_bytes: row.sizeBytes === null ? null : String(row.sizeBytes),
    record_count: row.recordCount,
    schema_version: row.schemaVersion,
    error_code: row.errorCode,
    error_message: row.errorMessage,
    started_at: row.startedAt?.toISOString() ?? null,
    completed_at: row.completedAt?.toISOString() ?? null,
    expires_at: row.expiresAt?.toISOString() ?? null,
    created_at: row.createdAt.toISOString(),
  };
}

function restoreModelOrder() {
  const names = [...RESTORABLE_SHOP_MODELS, ...Object.keys(RESTORABLE_CHILD_MODELS)];
  const included = new Set(names);
  const dependencies = new Map(names.map((name) => [name, new Set()]));
  for (const name of names) {
    const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === name);
    if (!model) throw appError(`Restore model metadata missing for ${name}`, 500, "RESTORE_MODEL_UNAVAILABLE");
    for (const field of model.fields) {
      if (field.kind === "object" && field.relationFromFields?.length && included.has(field.type) && field.type !== name) {
        dependencies.get(name).add(field.type);
      }
    }
  }
  const ordered = [];
  const remaining = new Set(names);
  while (remaining.size) {
    const ready = [...remaining].filter((name) => [...dependencies.get(name)].every((dependency) => !remaining.has(dependency))).sort();
    if (!ready.length) throw appError(`Restore model dependency cycle: ${[...remaining].sort().join(", ")}`, 500, "RESTORE_MODEL_CYCLE");
    for (const name of ready) { ordered.push(name); remaining.delete(name); }
  }
  return ordered;
}

function restoreScalarRow(modelName, row, shopId) {
  const model = Prisma.dmmf.datamodel.models.find((entry) => entry.name === modelName);
  if (!model || !row || typeof row !== "object" || Array.isArray(row)) throw appError(`Invalid ${modelName} backup row`, 400, "BACKUP_ROW_INVALID");
  if (model.fields.some((field) => field.kind === "scalar" && field.name === "shopId") && row.shopId !== shopId) {
    throw appError(`Backup row tenant mismatch in ${modelName}`, 403, "BACKUP_TENANT_MISMATCH");
  }
  const result = {};
  for (const field of model.fields.filter((entry) => entry.kind === "scalar" || entry.kind === "enum")) {
    if (!(field.name in row)) continue;
    const value = row[field.name];
    if (value === null || value === undefined) { result[field.name] = value; continue; }
    if (field.type === "DateTime") {
      const date = new Date(value);
      if (Number.isNaN(date.getTime())) throw appError(`Invalid date in ${modelName}.${field.name}`, 400, "BACKUP_ROW_INVALID");
      result[field.name] = date;
    } else if (field.type === "BigInt") {
      const encoded = value?.$kiranaosBigInt ?? value;
      try { result[field.name] = BigInt(encoded); } catch { throw appError(`Invalid bigint in ${modelName}.${field.name}`, 400, "BACKUP_ROW_INVALID"); }
    } else result[field.name] = value;
  }
  return result;
}

function assertCompleteRestoreSnapshot(snapshot, shopId) {
  const manifest = snapshot?.manifest;
  const data = snapshot?.data;
  if (manifest?.product !== "KiranaOS" || manifest?.format !== BACKUP_FORMAT || manifest?.schemaVersion !== BACKUP_SCHEMA_VERSION || manifest?.dataLayout !== "flat_prisma_tables_v2") {
    throw appError("Backup is not compatible with complete transactional restore", 409, "BACKUP_SCHEMA_INCOMPATIBLE");
  }
  if (manifest.shopId !== shopId || data?.shop?.id !== shopId) throw appError("Backup belongs to a different shop", 403, "BACKUP_TENANT_MISMATCH");
  const required = [...RESTORABLE_SHOP_MODELS, ...Object.keys(RESTORABLE_CHILD_MODELS)].sort();
  if (!data.tables || JSON.stringify(Object.keys(data.tables).sort()) !== JSON.stringify(required)) {
    throw appError("Backup table manifest is incomplete", 409, "BACKUP_TABLES_INCOMPLETE");
  }
  for (const name of required) if (!Array.isArray(data.tables[name])) throw appError(`Backup table ${name} is invalid`, 400, "BACKUP_TABLE_INVALID");
  return { manifest, data };
}

async function createImmediateRecoveryBackup(shopId, userId) {
  assertBackupStorageSafe();
  const artifact = await db.backupArtifact.create({ data: {
    shopId, requestedByUserId: userId, type: "shop_logical", status: "queued",
    expiresAt: new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000),
  } });
  return processShopBackupArtifact(artifact.id, shopId);
}

async function replaceRestorableShopData(tx, shopId, snapshot) {
  const { data } = assertCompleteRestoreSnapshot(snapshot, shopId);
  // A restore intentionally rewinds the shop's business audit trail to the
  // selected point in time. The backup/restore control trail is different: it
  // records the owner-sensitive operation doing the rewind and must never be
  // erased by a later rollback. Capture those rows inside the same serializable
  // transaction, then append only rows that are not already in the artifact.
  const preservedControlAudits = await tx.auditLog.findMany({
    where: { shopId, action: { in: RESTORE_PRESERVED_AUDIT_ACTIONS } },
  });
  const order = restoreModelOrder();
  for (const modelName of [...order].reverse()) {
    const delegate = tx[prismaDelegateName(modelName)];
    const childPolicy = RESTORABLE_CHILD_MODELS[modelName];
    await delegate.deleteMany({ where: childPolicy ? childWhereForShop(childPolicy.where, shopId) : { shopId } });
  }
  const shopFields = ["name", "ownerName", "city", "address", "gstNumber", "phone", "settingsJson"];
  await tx.shop.update({ where: { id: shopId }, data: Object.fromEntries(shopFields.filter((name) => name in data.shop).map((name) => [name, data.shop[name]])) });
  let restoredRecords = 0;
  for (const modelName of order) {
    const rows = data.tables[modelName].map((row) => restoreScalarRow(modelName, row, shopId));
    if (!rows.length) continue;
    await tx[prismaDelegateName(modelName)].createMany({ data: rows });
    restoredRecords += rows.length;
  }
  const snapshotAuditIds = new Set((data.tables.AuditLog ?? []).map((row) => row?.id).filter(Boolean));
  const controlAuditsToAppend = preservedControlAudits
    .filter((row) => !snapshotAuditIds.has(row.id))
    .map((row) => restoreScalarRow("AuditLog", row, shopId));
  if (controlAuditsToAppend.length > 0) {
    await tx.auditLog.createMany({ data: controlAuditsToAppend });
  }
  await tx.shop.update({ where: { id: shopId }, data: { dataEpoch: { increment: 1 } } });
  return { restoredRecords, restoredTables: order.length };
}

export async function restoreShopBackup(shopId, artifactId, userId, confirmation) {
  if (String(confirmation || "").trim() !== `RESTORE ${artifactId.slice(-6)}`) {
    throw appError(`Type RESTORE ${artifactId.slice(-6)} to confirm`, 422, "BACKUP_RESTORE_CONFIRMATION_REQUIRED");
  }
  const { snapshot } = await loadVerifiedSnapshot(shopId, artifactId);
  assertCompleteRestoreSnapshot(snapshot, shopId);
  const lock = await acquireShopMaintenanceLock(shopId, userId, `restore:${artifactId}`);
  let recoveryBackup = null;
  try {
    recoveryBackup = await createImmediateRecoveryBackup(shopId, userId);
    const result = await db.$transaction(async (tx) => {
      const restored = await replaceRestorableShopData(tx, shopId, snapshot);
      await writeRequiredBackupAudit({
        shopId, userId, action: "SHOP_BACKUP_RESTORED", entityType: "BackupArtifact", entityId: artifactId,
        metadata: { recoveryArtifactId: recoveryBackup.id, schemaVersion: BACKUP_SCHEMA_VERSION, ...restored },
      }, tx);
      return restored;
    }, {
      isolationLevel: "Serializable", maxWait: 15_000, timeout: 180_000,
    });
    return { ...result, artifact_id: artifactId, recovery_backup: recoveryBackup };
  } finally {
    await releaseShopMaintenanceLock(shopId, lock.token).catch(() => undefined);
  }
}

export async function createAndEnqueueShopBackup(shopId, userId) {
  assertBackupStorageSafe();
  const artifact = await db.$transaction(async (tx) => {
    const created = await tx.backupArtifact.create({
      data: {
        shopId,
        requestedByUserId: userId,
        type: "shop_logical",
        status: "queued",
        expiresAt: new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000),
      },
    });
    await writeRequiredBackupAudit({
      shopId,
      userId,
      action: "SHOP_BACKUP_REQUESTED",
      entityType: "BackupArtifact",
      entityId: created.id,
      metadata: { type: created.type, encrypted: true, expiresAt: created.expiresAt },
    }, tx);
    return created;
  });
  if (!isQueueEnabled()) {
    if (env.NODE_ENV === "production") {
      await db.backupArtifact.update({
        where: { id: artifact.id },
        data: { status: "failed", errorCode: "JOB_QUEUE_DISABLED", errorMessage: "Backup queue unavailable" },
      });
      throw appError("Backup queue is disabled", 503, "JOB_QUEUE_DISABLED");
    }
    return processShopBackupArtifact(artifact.id, shopId);
  }
  const queued = await addJob(
    QUEUE_NAMES.backupQueue,
    JOB_NAMES.RUN_SHOP_BACKUP,
    { artifactId: artifact.id, shopId, userId },
    { jobId: `shop-backup-${artifact.id}` },
  );
  if (!queued.queued) {
    await db.backupArtifact.update({
      where: { id: artifact.id },
      data: { status: "failed", errorCode: queued.code, errorMessage: "Backup queue unavailable" },
    });
    throw appError("Backup queue is unavailable", 503, queued.code || "JOB_QUEUE_UNAVAILABLE");
  }
  return publicArtifact(artifact);
}

export async function processShopBackupArtifact(artifactId, expectedShopId) {
  assertBackupStorageSafe();
  const artifact = await db.backupArtifact.findUnique({ where: { id: artifactId } });
  if (!artifact || !artifact.shopId || artifact.shopId !== expectedShopId) {
    throw appError("Backup artifact not found", 404, "BACKUP_ARTIFACT_NOT_FOUND");
  }
  if (artifact.status === "completed") return publicArtifact(artifact);
  const staleClaimBefore = new Date(Date.now() - 30 * 60 * 1000);
  const claimed = await db.backupArtifact.updateMany({
    where: {
      id: artifact.id,
      OR: [
        { status: { in: ["queued", "failed"] } },
        { status: "processing", startedAt: { lt: staleClaimBefore } },
      ],
    },
    data: { status: "processing", startedAt: new Date(), errorCode: null, errorMessage: null },
  });
  if (claimed.count !== 1) {
    const current = await db.backupArtifact.findUnique({ where: { id: artifact.id } });
    if (current?.status === "completed") return publicArtifact(current);
    throw appError("Backup artifact is already being processed", 409, "BACKUP_IN_PROGRESS");
  }
  try {
    const snapshot = await db.$transaction(
      (tx) => buildCompleteShopSnapshot(artifact.shopId, tx),
      { isolationLevel: "Serializable", maxWait: 10_000, timeout: 120_000 },
    );
    const plain = Buffer.from(stringifySnapshot(snapshot), "utf8");
    if (plain.length > MAX_UNCOMPRESSED_BYTES) {
      throw appError("Shop backup exceeds the 256 MiB logical snapshot limit", 413, "BACKUP_TOO_LARGE");
    }
    const encrypted = encryptSnapshot(plain);
    const checksum = crypto.createHash("sha256").update(encrypted).digest("hex");
    const key = backupKey(artifact.shopId, artifact.id);
    const stored = await putObject({
      key,
      body: encrypted,
      contentType: "application/vnd.kiranaos.backup",
      metadata: { artifactId: artifact.id, format: BACKUP_FORMAT, checksumSha256: checksum },
    });
    const completed = await db.$transaction(async (tx) => {
      const updated = await tx.backupArtifact.update({
        where: { id: artifact.id },
        data: {
          status: "completed",
          format: BACKUP_FORMAT,
          storageProvider: stored.provider,
          objectKey: key,
          checksumSha256: checksum,
          sizeBytes: BigInt(encrypted.length),
          recordCount: countRows(snapshot.data),
          schemaVersion: BACKUP_SCHEMA_VERSION,
          completedAt: new Date(),
        },
      });
      await writeRequiredBackupAudit({
        shopId: artifact.shopId,
        userId: artifact.requestedByUserId,
        action: "SHOP_BACKUP_COMPLETED",
        entityType: "BackupArtifact",
        entityId: artifact.id,
        metadata: {
          format: BACKUP_FORMAT,
          checksumSha256: checksum,
          sizeBytes: String(encrypted.length),
          recordCount: updated.recordCount,
        },
      }, tx);
      return updated;
    });
    return publicArtifact(completed);
  } catch (error) {
    await db.backupArtifact.update({
      where: { id: artifact.id },
      data: {
        status: "failed",
        errorCode: String(error?.code || "BACKUP_FAILED").slice(0, 100),
        errorMessage: String(error?.message || "Backup failed").slice(0, 500),
        completedAt: new Date(),
      },
    }).catch(() => undefined);
    throw error;
  }
}

export async function listShopBackups(shopId, { limit = 25 } = {}) {
  const rows = await db.backupArtifact.findMany({
    where: { shopId, type: "shop_logical" },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 25, 1), 100),
  });
  return { backups: rows.map(publicArtifact), retention_days: env.BACKUP_RETENTION_DAYS };
}

export async function openShopBackup(shopId, artifactId) {
  // Verify the exact encrypted envelope before handing it to the HTTP response.
  // Object storage can acknowledge an upload and still suffer later corruption;
  // discovering that only during a disaster-recovery drill is too late.
  const { row, encrypted } = await loadVerifiedSnapshot(shopId, artifactId);
  return {
    kind: "stream",
    fileName: `kiranaos-shop-${shopId}-${row.id}.kosb`,
    stream: Readable.from(encrypted),
    contentLength: encrypted.length,
  };
}

export async function previewShopBackupRestore(shopId, artifactId) {
  const { row, snapshot } = await loadVerifiedSnapshot(shopId, artifactId);
  const manifest = snapshot?.manifest;
  const data = snapshot?.data;
  if (!manifest || !data || typeof data !== "object" || Array.isArray(data)) {
    throw appError("Backup manifest or data is missing", 400, "BACKUP_STRUCTURE_INVALID");
  }
  if (manifest.product !== "KiranaOS" || manifest.format !== BACKUP_FORMAT) {
    throw appError("Backup format is not supported", 409, "BACKUP_FORMAT_UNSUPPORTED");
  }
  if (manifest.schemaVersion !== BACKUP_SCHEMA_VERSION || row.schemaVersion !== BACKUP_SCHEMA_VERSION) {
    throw appError("Backup schema is not compatible with this release", 409, "BACKUP_SCHEMA_INCOMPATIBLE");
  }
  if (manifest.shopId !== shopId || data.shop?.id !== shopId) {
    throw appError("Backup belongs to a different shop", 403, "BACKUP_TENANT_MISMATCH");
  }
  if (manifest.dataLayout !== "flat_prisma_tables_v2" || !data.tables || typeof data.tables !== "object") {
    throw appError("Backup table layout is not restorable", 409, "BACKUP_LAYOUT_INCOMPATIBLE");
  }
  const tableCounts = Object.fromEntries(
    Object.entries(data.tables)
      .filter(([, value]) => Array.isArray(value))
      .map(([name, value]) => [name, value.length])
      .sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    artifact_id: row.id,
    restorable: true,
    schema_version: manifest.schemaVersion,
    created_at: manifest.createdAt,
    record_count: Object.values(tableCounts).reduce((sum, value) => sum + value, 0),
    table_counts: tableCounts,
    credentials_preserved: true,
    warnings: [
      "Current passwords, owner PINs, sessions, device identities, and integration secrets will be preserved.",
      "A fresh pre-restore snapshot and final confirmation are required before any records can be replaced.",
    ],
  };
}

export async function cleanupExpiredShopBackups({ limit = 100 } = {}) {
  const now = new Date();
  const rows = await db.backupArtifact.findMany({
    where: { status: "completed", expiresAt: { lte: now }, objectKey: { not: null } },
    orderBy: { expiresAt: "asc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
  });
  let cleaned = 0;
  for (const row of rows) {
    try {
      await deleteObject({ key: row.objectKey });
      await db.backupArtifact.update({
        where: { id: row.id },
        data: { status: "expired", objectKey: null, errorMessage: "Encrypted backup expired and was deleted" },
      });
      cleaned += 1;
    } catch {
      // Leave metadata/object key intact so the bounded job can retry safely.
    }
  }
  return { status: "completed", checked: rows.length, cleaned, hasMore: rows.length === Math.min(Math.max(Number(limit) || 100, 1), 500) };
}

export async function verifyBackupArtifactForTest(shopId, artifactId) {
  const { snapshot } = await loadVerifiedSnapshot(shopId, artifactId);
  return snapshot;
}

export const __backupInternals = {
  BACKUP_FORMAT,
  BACKUP_HEADER,
  backupKey,
  countRows,
  decryptSnapshot,
  encryptSnapshot,
  encryptionKey,
  parseSnapshot,
  stringifySnapshot,
  assertCompleteRestoreSnapshot,
  restoreModelOrder,
  restoreScalarRow,
  replaceRestorableShopData,
};
