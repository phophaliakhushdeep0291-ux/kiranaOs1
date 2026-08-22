import crypto from "node:crypto";
import fsp from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env.js";
import { deleteObject, getObjectStream, listObjects, putObject } from "../../lib/objectStorage.js";

const DATABASE_BACKUP_ROOT = "backups/database";

// putObject buffers the whole body before it writes, so a dump larger than this
// would be an out-of-memory crash rather than a failed upload. Fail with a name
// instead: a shop that has outgrown a buffered upload needs a streaming one, and
// the daily job going red is how anyone finds out.
const MAX_DATABASE_BACKUP_BYTES = 512 * 1024 * 1024;

function backupError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function safeDatabaseSegment(databaseName) {
  const segment = String(databaseName || "").replace(/[^A-Za-z0-9_-]/g, "_").slice(0, 64);
  if (!segment) throw backupError("A database name is required to key a backup", "DATABASE_BACKUP_NAME_REQUIRED");
  return segment;
}

/**
 * Local storage in production is the ephemeral container disk this whole path
 * exists to get off. A "successful" upload back onto it would look green in
 * every log and hold nothing after a redeploy, so refuse it by name — the same
 * rule the tenant artifact path already applies.
 */
export function assertDatabaseBackupStorageSafe(nodeEnv, storageProvider) {
  if (nodeEnv === "production" && storageProvider === "local") {
    throw backupError(
      "Production database backups require S3, R2, or MinIO object storage",
      "DATABASE_BACKUP_STORAGE_NOT_PRODUCTION_SAFE",
    );
  }
}

export function databaseBackupPrefix(databaseName) {
  return `${DATABASE_BACKUP_ROOT}/${safeDatabaseSegment(databaseName)}`;
}

export function databaseBackupKey(databaseName, fileName) {
  const base = path.basename(String(fileName || ""));
  if (!base || !/^[A-Za-z0-9._-]+$/.test(base)) {
    throw backupError("Unsafe backup file name", "UNSAFE_BACKUP_IDENTIFIER");
  }
  return `${databaseBackupPrefix(databaseName)}/${base}`;
}

async function sha256OfStream(stream) {
  const hash = crypto.createHash("sha256");
  let sizeBytes = 0;
  for await (const chunk of stream) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    sizeBytes += buffer.length;
    hash.update(buffer);
  }
  return { sha256: hash.digest("hex"), sizeBytes };
}

/**
 * Uploads one finished pg_dump to object storage and reads it back to prove it
 * arrived intact.
 *
 * The read-back is the point. A dump written to the container filesystem looked
 * like a successful backup for as long as the container lived; "the PUT did not
 * throw" is the same kind of evidence. Hashing what the bucket actually returns
 * is what makes this a backup rather than an intention.
 */
export async function uploadDatabaseBackup({ filePath, databaseName }) {
  assertDatabaseBackupStorageSafe(env.NODE_ENV, env.STORAGE_PROVIDER);
  const resolved = path.resolve(String(filePath || ""));
  const stat = await fsp.stat(resolved);
  if (!stat.size) throw backupError("Refusing to upload an empty backup file", "DATABASE_BACKUP_EMPTY");
  if (stat.size > MAX_DATABASE_BACKUP_BYTES) {
    throw backupError(
      `Backup is ${stat.size} bytes, above the ${MAX_DATABASE_BACKUP_BYTES}-byte buffered-upload ceiling`,
      "DATABASE_BACKUP_TOO_LARGE",
    );
  }

  const body = await fsp.readFile(resolved);
  const localSha256 = crypto.createHash("sha256").update(body).digest("hex");
  const key = databaseBackupKey(databaseName, path.basename(resolved));

  const stored = await putObject({
    key,
    body,
    contentType: "application/octet-stream",
    metadata: { sha256: localSha256, database: safeDatabaseSegment(databaseName) },
  });

  const { stream } = await getObjectStream({ key });
  const readBack = await sha256OfStream(stream);
  if (readBack.sizeBytes !== body.length || readBack.sha256 !== localSha256) {
    // Leave the object in place: a corrupt copy that can be inspected beats a
    // deleted one, and the local dump is still on disk at this point.
    throw backupError(
      `Stored backup does not match the local dump (${readBack.sizeBytes}/${readBack.sha256} vs ${body.length}/${localSha256})`,
      "DATABASE_BACKUP_VERIFICATION_FAILED",
    );
  }

  return {
    key,
    provider: stored.provider,
    sizeBytes: body.length,
    sha256: localSha256,
    verified: true,
  };
}

/**
 * Deletes dumps past the retention window, never dropping below `minRetained`.
 *
 * The floor is not a nicety. Age-only retention plus a backup job that has been
 * failing for a month deletes the last good dump on the day it is needed, and it
 * does it on schedule, quietly.
 */
export async function pruneDatabaseBackups({
  databaseName,
  retentionDays = env.BACKUP_RETENTION_DAYS,
  minRetained = env.DATABASE_BACKUP_MIN_RETAINED,
  now = new Date(),
} = {}) {
  const prefix = databaseBackupPrefix(databaseName);
  const objects = await listObjects({ prefix });
  const cutoff = now.getTime() - retentionDays * 24 * 60 * 60 * 1000;

  const deleted = [];
  // listObjects returns newest first, so anything at or past `minRetained` is
  // already known to have that many newer copies behind it.
  for (const object of objects.slice(minRetained)) {
    const modified = object.lastModified?.getTime();
    // No timestamp means the store could not say how old it is. Keeping it is
    // the safe reading of an unknown age.
    if (!modified || modified >= cutoff) continue;
    await deleteObject({ key: object.key });
    deleted.push({ key: object.key, sizeBytes: object.sizeBytes, lastModified: object.lastModified });
  }

  return {
    prefix,
    examined: objects.length,
    retained: objects.length - deleted.length,
    deleted,
    retentionDays,
    minRetained,
  };
}

export const __databaseBackupInternals = {
  DATABASE_BACKUP_ROOT,
  MAX_DATABASE_BACKUP_BYTES,
  safeDatabaseSegment,
  sha256OfStream,
};
