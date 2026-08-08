import { dexieDB, isScopedTableName } from "@/lib/offline/db";
import { getOfflineScope } from "@/lib/offline/context";

export const LOCAL_BACKUP_FORMAT = "ARTHA_LOCAL_BACKUP_V1";
export const LOCAL_BACKUP_SCHEMA_VERSION = 1;
export const LOCAL_BACKUP_CONFIRMATION = "RESTORE LOCAL BACKUP";
export const LOCAL_BACKUP_MIN_PASSPHRASE_LENGTH = 10;

const PBKDF2_ITERATIONS = 310_000;
const MAX_BACKUP_BYTES = 250 * 1024 * 1024;
const MAX_BACKUP_ROWS = 1_000_000;
const NON_TRANSFERABLE_TABLES = new Set(["device_license_cache"]);

export interface LocalBackupPayload {
  format: typeof LOCAL_BACKUP_FORMAT;
  schemaVersion: typeof LOCAL_BACKUP_SCHEMA_VERSION;
  databaseVersion: number;
  createdAt: string;
  scope: { tenant_id: string; store_id: string };
  device: { device_id: string; metadataOnly: true };
  tables: Record<string, Record<string, unknown>[]>;
}

interface LocalBackupEnvelope {
  format: typeof LOCAL_BACKUP_FORMAT;
  envelopeVersion: 1;
  createdAt: string;
  kdf: { name: "PBKDF2"; hash: "SHA-256"; iterations: number; salt: string };
  cipher: { name: "AES-GCM"; iv: string };
  ciphertext: string;
  ciphertextSha256: string;
}

export interface LocalBackupPreview {
  createdAt: string;
  databaseVersion: number;
  tableCounts: Record<string, number>;
  totalRows: number;
  pendingSyncCount: number;
  existingLocalRows: number;
  requiresReplace: boolean;
}

function assertCryptoAvailable() {
  if (!globalThis.crypto?.subtle) throw new Error("This browser cannot create encrypted local backups.");
}

function validatePassphrase(passphrase: string) {
  if (passphrase.length < LOCAL_BACKUP_MIN_PASSPHRASE_LENGTH) {
    throw new Error(`Backup passphrase must be at least ${LOCAL_BACKUP_MIN_PASSPHRASE_LENGTH} characters.`);
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 32_768) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 32_768));
  }
  return btoa(binary);
}

function base64ToBytes(value: string): Uint8Array<ArrayBuffer> {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.slice().buffer as ArrayBuffer;
}

async function sha256Hex(bytes: Uint8Array<ArrayBuffer>): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", toArrayBuffer(bytes)));
  return [...digest].map((value) => value.toString(16).padStart(2, "0")).join("");
}

async function deriveKey(passphrase: string, salt: Uint8Array<ArrayBuffer>, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(new TextEncoder().encode(passphrase)),
    "PBKDF2",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", hash: "SHA-256", salt: toArrayBuffer(salt), iterations },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function parseEnvelope(text: string): LocalBackupEnvelope {
  let envelope: Partial<LocalBackupEnvelope>;
  try {
    envelope = JSON.parse(text) as Partial<LocalBackupEnvelope>;
  } catch {
    throw new Error("This is not a valid Artha local backup file.");
  }
  if (
    envelope.format !== LOCAL_BACKUP_FORMAT
    || envelope.envelopeVersion !== 1
    || envelope.kdf?.name !== "PBKDF2"
    || envelope.kdf.hash !== "SHA-256"
    || envelope.cipher?.name !== "AES-GCM"
    || typeof envelope.ciphertext !== "string"
    || typeof envelope.ciphertextSha256 !== "string"
  ) throw new Error("Unsupported or damaged Artha local backup envelope.");
  if (envelope.kdf.iterations < PBKDF2_ITERATIONS) throw new Error("Backup encryption parameters are below the supported security floor.");
  return envelope as LocalBackupEnvelope;
}

function validatePayload(value: unknown): LocalBackupPayload {
  if (!value || typeof value !== "object") throw new Error("Backup payload is invalid.");
  const payload = value as Partial<LocalBackupPayload>;
  if (payload.format !== LOCAL_BACKUP_FORMAT || payload.schemaVersion !== LOCAL_BACKUP_SCHEMA_VERSION) {
    throw new Error("This local backup schema is not supported by this version of Artha.");
  }
  if (!payload.scope?.tenant_id || !payload.scope.store_id || !payload.tables || typeof payload.tables !== "object") {
    throw new Error("Backup scope or table data is missing.");
  }
  let totalRows = 0;
  for (const [tableName, rows] of Object.entries(payload.tables)) {
    if (!Array.isArray(rows)) throw new Error(`Backup table ${tableName} is invalid.`);
    totalRows += rows.length;
    if (totalRows > MAX_BACKUP_ROWS) throw new Error("Backup contains too many rows for a safe browser restore.");
    for (const row of rows) {
      if (!row || typeof row !== "object" || Array.isArray(row)) throw new Error(`Backup table ${tableName} contains an invalid row.`);
      if (isScopedTableName(tableName)) {
        const scoped = row as Record<string, unknown>;
        if (scoped.tenant_id !== payload.scope.tenant_id || scoped.store_id !== payload.scope.store_id) {
          throw new Error(`Backup table ${tableName} contains data outside its declared shop scope.`);
        }
      }
    }
  }
  return payload as LocalBackupPayload;
}

export async function encryptLocalBackupPayload(payload: LocalBackupPayload, passphrase: string): Promise<string> {
  assertCryptoAvailable();
  validatePassphrase(passphrase);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(passphrase, salt, PBKDF2_ITERATIONS);
  const plaintext = new TextEncoder().encode(JSON.stringify(payload));
  const encrypted = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  ));
  const envelope: LocalBackupEnvelope = {
    format: LOCAL_BACKUP_FORMAT,
    envelopeVersion: 1,
    createdAt: payload.createdAt,
    kdf: { name: "PBKDF2", hash: "SHA-256", iterations: PBKDF2_ITERATIONS, salt: bytesToBase64(salt) },
    cipher: { name: "AES-GCM", iv: bytesToBase64(iv) },
    ciphertext: bytesToBase64(encrypted),
    ciphertextSha256: await sha256Hex(encrypted),
  };
  return JSON.stringify(envelope);
}

export async function decryptLocalBackupEnvelope(text: string, passphrase: string): Promise<LocalBackupPayload> {
  assertCryptoAvailable();
  validatePassphrase(passphrase);
  if (new TextEncoder().encode(text).byteLength > MAX_BACKUP_BYTES) throw new Error("Backup file is too large for a safe browser restore.");
  const envelope = parseEnvelope(text);
  const encrypted = base64ToBytes(envelope.ciphertext);
  if (await sha256Hex(encrypted) !== envelope.ciphertextSha256) throw new Error("Backup checksum mismatch; the file is incomplete or changed.");
  try {
    const key = await deriveKey(passphrase, base64ToBytes(envelope.kdf.salt), envelope.kdf.iterations);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: toArrayBuffer(base64ToBytes(envelope.cipher.iv)) },
      key,
      toArrayBuffer(encrypted),
    );
    return validatePayload(JSON.parse(new TextDecoder().decode(plaintext)));
  } catch (error) {
    if (error instanceof Error && /scope|schema|payload|table|rows/i.test(error.message)) throw error;
    throw new Error("Backup passphrase is wrong or the encrypted file is damaged.");
  }
}

async function readCurrentScopeTables(): Promise<Record<string, Record<string, unknown>[]>> {
  await dexieDB.open();
  const scope = getOfflineScope();
  const tables: Record<string, Record<string, unknown>[]> = {};
  for (const table of dexieDB.tables) {
    if (NON_TRANSFERABLE_TABLES.has(table.name) || !isScopedTableName(table.name)) continue;
    const rows = await table.toArray() as Record<string, unknown>[];
    tables[table.name] = rows.filter((row) => row.tenant_id === scope.tenant_id && row.store_id === scope.store_id);
  }
  return tables;
}

export async function createEncryptedLocalBackup(passphrase: string): Promise<{ blob: Blob; createdAt: string; rowCount: number }> {
  const scope = getOfflineScope();
  const tables = await readCurrentScopeTables();
  const createdAt = new Date().toISOString();
  const payload: LocalBackupPayload = {
    format: LOCAL_BACKUP_FORMAT,
    schemaVersion: LOCAL_BACKUP_SCHEMA_VERSION,
    databaseVersion: dexieDB.verno,
    createdAt,
    scope: { tenant_id: scope.tenant_id, store_id: scope.store_id },
    device: { device_id: scope.device_id, metadataOnly: true },
    tables,
  };
  const text = await encryptLocalBackupPayload(payload, passphrase);
  const rowCount = Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
  return { blob: new Blob([text], { type: "application/vnd.artha.local-backup+json" }), createdAt, rowCount };
}

export function saveEncryptedLocalBackup(blob: Blob, createdAt: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = `artha-local-${createdAt.replace(/[:.]/g, "-")}.kalb`;
  anchor.rel = "noopener";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

async function readPayloadFromBlob(file: Blob, passphrase: string): Promise<LocalBackupPayload> {
  if (file.size > MAX_BACKUP_BYTES) throw new Error("Backup file is too large for a safe browser restore.");
  return decryptLocalBackupEnvelope(await file.text(), passphrase);
}

function assertSameShop(payload: LocalBackupPayload) {
  const scope = getOfflineScope();
  if (payload.scope.tenant_id !== scope.tenant_id || payload.scope.store_id !== scope.store_id) {
    throw new Error("This backup belongs to a different shop. Sign in to the matching shop before restoring it.");
  }
}

async function countExistingLocalRows(): Promise<number> {
  const tables = await readCurrentScopeTables();
  return Object.values(tables).reduce((sum, rows) => sum + rows.length, 0);
}

export async function previewEncryptedLocalBackup(file: Blob, passphrase: string): Promise<LocalBackupPreview> {
  const payload = await readPayloadFromBlob(file, passphrase);
  assertSameShop(payload);
  const tableCounts = Object.fromEntries(Object.entries(payload.tables).map(([name, rows]) => [name, rows.length]));
  const totalRows = Object.values(tableCounts).reduce((sum, count) => sum + count, 0);
  const pendingSyncCount = (payload.tables.sync_outbox ?? []).filter((row) => {
    const status = String(row.status ?? row.sync_status ?? "").toLowerCase();
    return ["pending", "pending_sync", "syncing", "failed", "conflict"].includes(status);
  }).length;
  const existingLocalRows = await countExistingLocalRows();
  return { createdAt: payload.createdAt, databaseVersion: payload.databaseVersion, tableCounts, totalRows, pendingSyncCount, existingLocalRows, requiresReplace: existingLocalRows > 0 };
}

function restoredRows(tableName: string, rows: Record<string, unknown>[]): Record<string, unknown>[] {
  if (tableName !== "sync_outbox") return rows;
  const currentDeviceId = getOfflineScope().device_id;
  return rows.map((row) => {
    const syncing = row.status === "SYNCING" || row.sync_status === "syncing";
    return {
      ...row,
      restored_from_device_id: row.device_id ?? null,
      device_id: currentDeviceId,
      ...(syncing ? {
        status: "PENDING",
        sync_status: "pending_sync",
        next_retry_at: null,
        error_message: "Recovered from an interrupted local backup restore",
        last_error: "Recovered from an interrupted local backup restore",
      } : {}),
    };
  });
}

export async function restoreEncryptedLocalBackup(
  file: Blob,
  passphrase: string,
  options: { confirmation: string; replaceExisting: boolean },
): Promise<{ restoredRows: number; restoredTables: number }> {
  if (options.confirmation.trim().toUpperCase() !== LOCAL_BACKUP_CONFIRMATION) {
    throw new Error(`Type ${LOCAL_BACKUP_CONFIRMATION} to confirm the local restore.`);
  }
  const payload = await readPayloadFromBlob(file, passphrase);
  assertSameShop(payload);
  await dexieDB.open();
  const currentScope = getOfflineScope();
  const knownTables = new Map(dexieDB.tables.map((table) => [table.name, table]));
  const unknownTables = Object.keys(payload.tables).filter((name) => !knownTables.has(name));
  if (unknownTables.length > 0) throw new Error(`Backup contains unsupported tables: ${unknownTables.join(", ")}.`);
  const unsafeTables = Object.keys(payload.tables).filter(
    (name) => NON_TRANSFERABLE_TABLES.has(name) || !isScopedTableName(name),
  );
  if (unsafeTables.length > 0) throw new Error(`Backup contains device-local or unscoped tables that cannot be restored: ${unsafeTables.join(", ")}.`);
  const transferableTables = dexieDB.tables.filter(
    (table) => isScopedTableName(table.name) && !NON_TRANSFERABLE_TABLES.has(table.name),
  );
  const missingTables = transferableTables
    .filter((table) => !Object.prototype.hasOwnProperty.call(payload.tables, table.name))
    .map((table) => table.name);
  if (missingTables.length > 0) throw new Error(`Backup is incomplete and is missing tables: ${missingTables.join(", ")}.`);
  const existingRows = await countExistingLocalRows();
  if (existingRows > 0 && !options.replaceExisting) {
    throw new Error("This device already has local data. Enable replacement only after reviewing the backup preview.");
  }

  let restoredRowCount = 0;
  let restoredTableCount = 0;
  await dexieDB.transaction("rw", transferableTables, async () => {
    const currentRowsByTable = new Map<string, Record<string, unknown>[]>();
    let transactionScopeRowCount = 0;
    for (const table of transferableTables) {
      const currentRows = await table.toArray() as Record<string, unknown>[];
      currentRowsByTable.set(table.name, currentRows);
      transactionScopeRowCount += currentRows.filter(
        (row) => row.tenant_id === currentScope.tenant_id && row.store_id === currentScope.store_id,
      ).length;
    }
    if (transactionScopeRowCount > 0 && !options.replaceExisting) {
      throw new Error("This device already has local data. Enable replacement only after reviewing the backup preview.");
    }

    for (const table of transferableTables) {
      const keyPath = table.schema.primKey.keyPath;
      if (typeof keyPath !== "string") throw new Error(`Cannot safely restore table ${table.name}: unsupported primary key.`);
      const currentRows = currentRowsByTable.get(table.name) ?? [];
      const currentKeys = currentRows
        .filter((row) => row.tenant_id === currentScope.tenant_id && row.store_id === currentScope.store_id)
        .map((row) => row[keyPath])
        .filter((key): key is string | number => typeof key === "string" || typeof key === "number");
      if (currentKeys.length > 0) await table.bulkDelete(currentKeys);

      const rows = restoredRows(table.name, payload.tables[table.name] ?? []);
      if (rows.length > 0) await table.bulkPut(rows);
      restoredRowCount += rows.length;
      restoredTableCount += 1;
    }
  });
  window.dispatchEvent(new CustomEvent("kirana:local-data-changed", { detail: { action: "local-backup-restored" } }));
  window.dispatchEvent(new CustomEvent("kirana:sync-queue-updated", { detail: { action: "local-backup-restored" } }));
  return { restoredRows: restoredRowCount, restoredTables: restoredTableCount };
}
