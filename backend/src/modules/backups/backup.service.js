import crypto from "node:crypto";
import { gzipSync, gunzipSync } from "node:zlib";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { addJob, isQueueEnabled } from "../../lib/queue.js";
import {
  deleteObject,
  getObject,
  getObjectStream,
  putObject,
} from "../../lib/objectStorage.js";
import { JOB_NAMES, QUEUE_NAMES } from "../../workers/queueNames.js";
import { createAuditLog } from "../audit/audit.service.js";

const BACKUP_FORMAT = "kiranaos_aes256gcm_gzip_v1";
const BACKUP_SCHEMA_VERSION = "2026-07-28";
const BACKUP_HEADER = Buffer.from("KOSB1", "ascii");
const MAX_UNCOMPRESSED_BYTES = 256 * 1024 * 1024;

function appError(message, statusCode, code) {
  return new AppError(message, statusCode, code);
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

function countRows(value) {
  if (!value || typeof value !== "object") return 0;
  if (Array.isArray(value)) return value.length + value.reduce((sum, item) => sum + countNestedArrays(item), 0);
  return Object.values(value).reduce((sum, item) => sum + (Array.isArray(item) ? countRows(item) : 0), 0);
}

function countNestedArrays(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).reduce((sum, item) => {
    if (Array.isArray(item)) return sum + countRows(item);
    return sum + countNestedArrays(item);
  }, 0);
}

async function buildShopSnapshot(shopId, client = db) {
  const shop = await client.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw appError("Shop not found", 404, "SHOP_NOT_FOUND");

  const [
    users,
    products,
    customers,
    bills,
    pricingRules,
    customerOrders,
    storeLocations,
    locationStocks,
    stockCountSessions,
    stockTransfers,
    transferDocumentCounters,
    giftCards,
    giftCardTransactions,
    loyaltyPrograms,
    loyaltyAccounts,
    loyaltyTransactions,
    complianceDocuments,
    stockLedger,
    udharLedger,
    suppliers,
    expenses,
    offers,
    purchaseHistory,
    purchaseOrders,
    purchaseReceipts,
    purchaseReturns,
    inventoryLots,
    userLocationAccess,
    auditLogs,
    dailyClosingSnapshots,
    reminderTemplates,
    reminderLogs,
    financialLedger,
    bankStatementImports,
    bankStatementTransactions,
    bankReconciliationAllocations,
    bankReconciliationEvents,
    subscriptions,
    paymentTransactions,
  ] = await Promise.all([
    client.user.findMany({
      where: { shopId },
      select: { id: true, shopId: true, name: true, mobile: true, email: true, emailVerifiedAt: true, role: true, disabledAt: true, createdAt: true, updatedAt: true },
    }),
    client.product.findMany({ where: { shopId }, include: { sellingUnits: true } }),
    client.customer.findMany({ where: { shopId } }),
    client.bill.findMany({ where: { shopId }, include: { items: { include: { lotAllocations: true } }, payments: true } }),
    client.pricingRule.findMany({ where: { shopId } }),
    client.customerOrder.findMany({ where: { shopId } }),
    client.storeLocation.findMany({ where: { shopId } }),
    client.locationStock.findMany({ where: { shopId } }),
    client.stockCountSession.findMany({ where: { shopId }, include: { lines: true } }),
    client.stockTransfer.findMany({ where: { shopId }, include: { items: true } }),
    client.transferDocumentCounter.findMany({ where: { shopId } }),
    client.giftCard.findMany({ where: { shopId } }),
    client.giftCardTransaction.findMany({ where: { shopId } }),
    client.loyaltyProgram.findMany({ where: { shopId } }),
    client.loyaltyAccount.findMany({ where: { shopId } }),
    client.loyaltyTransaction.findMany({ where: { shopId } }),
    client.complianceDocument.findMany({ where: { shopId } }),
    client.stockLedger.findMany({ where: { shopId } }),
    client.udharLedger.findMany({ where: { shopId } }),
    client.supplier.findMany({ where: { shopId } }),
    client.expense.findMany({ where: { shopId } }),
    client.offer.findMany({ where: { shopId } }),
    client.purchaseHistory.findMany({ where: { shopId } }),
    client.purchaseOrder.findMany({ where: { shopId }, include: { items: true } }),
    client.purchaseReceipt.findMany({ where: { shopId }, include: { items: true } }),
    client.purchaseReturn.findMany({ where: { shopId }, include: { items: true } }),
    client.inventoryLot.findMany({ where: { shopId } }),
    client.userLocationAccess.findMany({ where: { shopId } }),
    client.auditLog.findMany({ where: { shopId } }),
    client.dailyClosingSnapshot.findMany({ where: { shopId } }),
    client.reminderTemplate.findMany({ where: { shopId } }),
    client.reminderLog.findMany({ where: { shopId } }),
    client.financialLedger.findMany({ where: { shopId } }),
    client.bankStatementImport.findMany({ where: { shopId } }),
    client.bankStatementTransaction.findMany({ where: { shopId } }),
    client.bankReconciliationAllocation.findMany({ where: { shopId } }),
    client.bankReconciliationEvent.findMany({ where: { shopId } }),
    client.subscription.findMany({ where: { shopId } }),
    client.paymentTransaction.findMany({ where: { shopId } }),
  ]);

  const data = {
    shop,
    users,
    products,
    customers,
    bills,
    pricingRules,
    customerOrders,
    storeLocations,
    locationStocks,
    stockCountSessions,
    stockTransfers,
    transferDocumentCounters,
    giftCards,
    giftCardTransactions,
    loyaltyPrograms,
    loyaltyAccounts,
    loyaltyTransactions,
    complianceDocuments,
    stockLedger,
    udharLedger,
    suppliers,
    expenses,
    offers,
    purchaseHistory,
    purchaseOrders,
    purchaseReceipts,
    purchaseReturns,
    inventoryLots,
    userLocationAccess,
    auditLogs,
    dailyClosingSnapshots,
    reminderTemplates,
    reminderLogs,
    financialLedger,
    bankStatementImports,
    bankStatementTransactions,
    bankReconciliationAllocations,
    bankReconciliationEvents,
    subscriptions,
    paymentTransactions,
  };
  return {
    manifest: {
      product: "KiranaOS",
      format: BACKUP_FORMAT,
      schemaVersion: BACKUP_SCHEMA_VERSION,
      createdAt: new Date().toISOString(),
      shopId,
      bigintEncoding: "{ $kiranaosBigInt: decimal-string }",
      credentialsExcluded: [
        "passwordHash",
        "pinHash",
        "refresh/session tokens",
        "device fingerprints",
        "integration API key hashes",
        "webhook secrets",
      ],
    },
    data,
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

export async function createAndEnqueueShopBackup(shopId, userId) {
  assertBackupStorageSafe();
  const artifact = await db.backupArtifact.create({
    data: {
      shopId,
      requestedByUserId: userId,
      type: "shop_logical",
      status: "queued",
      expiresAt: new Date(Date.now() + env.BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  await createAuditLog({
    shopId,
    userId,
    action: "SHOP_BACKUP_REQUESTED",
    entityType: "BackupArtifact",
    entityId: artifact.id,
    metadata: { type: artifact.type, encrypted: true, expiresAt: artifact.expiresAt },
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
      (tx) => buildShopSnapshot(artifact.shopId, tx),
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
    const completed = await db.backupArtifact.update({
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
    await createAuditLog({
      shopId: artifact.shopId,
      userId: artifact.requestedByUserId,
      action: "SHOP_BACKUP_COMPLETED",
      entityType: "BackupArtifact",
      entityId: artifact.id,
      metadata: {
        format: BACKUP_FORMAT,
        checksumSha256: checksum,
        sizeBytes: String(encrypted.length),
        recordCount: completed.recordCount,
      },
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
  const row = await db.backupArtifact.findFirst({
    where: { id: artifactId, shopId, status: "completed", type: "shop_logical" },
  });
  if (!row?.objectKey) throw appError("Completed backup artifact not found", 404, "BACKUP_ARTIFACT_NOT_FOUND");
  return {
    kind: "stream",
    fileName: `kiranaos-shop-${shopId}-${row.id}.kosb`,
    ...(await getObjectStream({ key: row.objectKey })),
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
  const row = await db.backupArtifact.findFirst({ where: { id: artifactId, shopId, status: "completed" } });
  if (!row?.objectKey) throw appError("Backup artifact not found", 404, "BACKUP_ARTIFACT_NOT_FOUND");
  const encrypted = await getObject({ key: row.objectKey });
  const checksum = crypto.createHash("sha256").update(encrypted).digest("hex");
  if (checksum !== row.checksumSha256) throw appError("Backup checksum mismatch", 409, "BACKUP_CHECKSUM_MISMATCH");
  return JSON.parse(decryptSnapshot(encrypted).toString("utf8"));
}

export const __backupInternals = {
  BACKUP_FORMAT,
  BACKUP_HEADER,
  backupKey,
  countRows,
  decryptSnapshot,
  encryptSnapshot,
  encryptionKey,
  stringifySnapshot,
};
