import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import { Readable } from "stream";
import { env } from "../config/env.js";
import { logger } from "./logger.js";
import { recordStorageError } from "./metrics.js";

const LOCAL_EXPORT_ROOT = path.resolve(process.cwd(), "storage");
const CLOUD_PROVIDERS = new Set(["s3", "r2", "minio"]);
const S3_COMPATIBLE_PROVIDERS = new Set(["s3", "r2", "minio"]);

let cachedS3Client = null;
let awsLoadError = null;

function maskStorageValue(value) {
  if (!value) return null;
  const raw = String(value);
  if (raw.length <= 6) return "[REDACTED]";
  return `${raw.slice(0, 3)}***${raw.slice(-3)}`;
}

function assertRelativeSafeKey(key) {
  const raw = String(key || "").replace(/\\/g, "/").trim();
  if (
    !raw ||
    raw.includes("..") ||
    raw.startsWith("/") ||
    /(^|\/)\.(\.?)(\/|$)/.test(raw) ||
    /[\u0000-\u001f]/.test(raw)
  ) {
    const error = new Error("Unsafe storage key");
    error.code = "PATH_TRAVERSAL_BLOCKED";
    throw error;
  }
  return raw;
}

function localPathForKey(key) {
  const safeKey = assertRelativeSafeKey(key);
  const resolved = path.resolve(LOCAL_EXPORT_ROOT, safeKey);
  if (!resolved.startsWith(`${LOCAL_EXPORT_ROOT}${path.sep}`)) {
    const error = new Error("Unsafe local storage path");
    error.code = "PATH_TRAVERSAL_BLOCKED";
    throw error;
  }
  return resolved;
}

function cloudRegion() {
  if (env.STORAGE_REGION) return env.STORAGE_REGION;
  return env.STORAGE_PROVIDER === "r2" ? "auto" : "us-east-1";
}

function requireCloudConfig(operation = "object storage") {
  if (!S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) return;
  const missing = [];
  if (!env.STORAGE_BUCKET) missing.push("STORAGE_BUCKET");
  if (!env.STORAGE_ACCESS_KEY_ID) missing.push("STORAGE_ACCESS_KEY_ID");
  if (!env.STORAGE_SECRET_ACCESS_KEY) missing.push("STORAGE_SECRET_ACCESS_KEY");
  if ((env.STORAGE_PROVIDER === "r2" || env.STORAGE_PROVIDER === "minio") && !env.STORAGE_ENDPOINT) missing.push("STORAGE_ENDPOINT");
  if (missing.length) {
    const error = new Error(`${missing.join(", ")} required for ${operation} with ${env.STORAGE_PROVIDER}`);
    error.code = "OBJECT_STORAGE_CONFIG_MISSING";
    throw error;
  }
}

async function getS3Client() {
  if (cachedS3Client) return cachedS3Client;
  requireCloudConfig("S3-compatible storage");
  try {
    const { S3Client } = await import("@aws-sdk/client-s3");
    cachedS3Client = new S3Client({
      region: cloudRegion(),
      endpoint: env.STORAGE_ENDPOINT || undefined,
      forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
      credentials: {
        accessKeyId: env.STORAGE_ACCESS_KEY_ID,
        secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY,
      },
    });
    return cachedS3Client;
  } catch (error) {
    awsLoadError = error;
    const e = new Error("AWS S3 SDK is unavailable for object storage");
    e.code = "OBJECT_STORAGE_SDK_UNAVAILABLE";
    e.cause = error;
    throw e;
  }
}

async function streamToBuffer(stream) {
  if (Buffer.isBuffer(stream)) return stream;
  if (typeof stream === "string") return Buffer.from(stream);
  const chunks = [];
  for await (const chunk of stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export function getObjectStorageStatus() {
  return {
    provider: env.STORAGE_PROVIDER,
    localDevOnly: env.STORAGE_PROVIDER === "local",
    publicDownloadsEnabled: env.EXPORT_DOWNLOADS_PUBLIC,
    signedUrlTtlSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS,
    bucketConfigured: Boolean(env.STORAGE_BUCKET),
    endpointConfigured: Boolean(env.STORAGE_ENDPOINT),
    forcePathStyle: env.STORAGE_FORCE_PATH_STYLE,
    sdkLoaded: Boolean(cachedS3Client),
    sdkError: awsLoadError?.message ?? null,
  };
}

export function assertObjectStorageProductionSafe() {
  if (env.NODE_ENV === "production" && env.EXPORT_DOWNLOADS_PUBLIC && env.STORAGE_PROVIDER === "local") {
    const error = new Error("Local storage is development-only for public export downloads");
    error.code = "LOCAL_STORAGE_NOT_PUBLIC_PRODUCTION_SAFE";
    throw error;
  }
  if (env.NODE_ENV === "production" && CLOUD_PROVIDERS.has(env.STORAGE_PROVIDER)) {
    requireCloudConfig("production object storage");
  }
}

export async function putObject({ key, body, contentType, metadata = {} }) {
  assertObjectStorageProductionSafe();
  const safeKey = assertRelativeSafeKey(key);
  try {
    if (env.STORAGE_PROVIDER === "local") {
      const filePath = localPathForKey(safeKey);
      await fsp.mkdir(path.dirname(filePath), { recursive: true });
      const buffer = Buffer.isBuffer(body) ? body : Buffer.from(String(body ?? ""));
      await fsp.writeFile(filePath, buffer);
      const stat = await fsp.stat(filePath);
      return { provider: "local", key: safeKey, filePath, contentType, sizeBytes: stat.size };
    }

    if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      const { PutObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      const buffer = await streamToBuffer(body ?? "");
      await client.send(new PutObjectCommand({
        Bucket: env.STORAGE_BUCKET,
        Key: safeKey,
        Body: buffer,
        ContentType: contentType || "application/octet-stream",
        Metadata: Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [String(k).slice(0, 64), String(v).slice(0, 256)])),
      }));
      return { provider: env.STORAGE_PROVIDER, key: safeKey, filePath: safeKey, contentType, sizeBytes: buffer.length };
    }
  } catch (error) {
    recordStorageError(env.STORAGE_PROVIDER, "putObject");
    logger.error({ type: "storage_error", operation: "putObject", provider: env.STORAGE_PROVIDER, errorCode: error?.code, message: error?.message, key: safeKey });
    throw error;
  }

  // do not fake cloud upload success: OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED is kept as a guard for future providers; cloud upload is never faked.
  const error = new Error(`${env.STORAGE_PROVIDER} object storage adapter is not implemented yet`);
  error.code = "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED";
  throw error;
}

export async function getObjectStream({ key, filePath }) {
  assertObjectStorageProductionSafe();
  const safeKey = key ? assertRelativeSafeKey(key) : null;
  try {
    if (env.STORAGE_PROVIDER === "local") {
      const target = filePath ? path.resolve(String(filePath)) : localPathForKey(safeKey);
      if (!target.startsWith(`${LOCAL_EXPORT_ROOT}${path.sep}`)) {
        const error = new Error("Unsafe local storage path");
        error.code = "PATH_TRAVERSAL_BLOCKED";
        throw error;
      }
      const stat = await fsp.stat(target);
      return { stream: fs.createReadStream(target), contentLength: stat.size };
    }

    if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      const result = await client.send(new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey }));
      return { stream: result.Body, contentLength: result.ContentLength ?? null };
    }
  } catch (error) {
    recordStorageError(env.STORAGE_PROVIDER, "getObjectStream");
    logger.error({ type: "storage_error", operation: "getObjectStream", provider: env.STORAGE_PROVIDER, errorCode: error?.code, message: error?.message, key: safeKey });
    throw error;
  }

  const error = new Error(`${env.STORAGE_PROVIDER} object storage download is not implemented yet`);
  error.code = "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED";
  throw error;
}

export async function getObject({ key, filePath }) {
  const { stream } = await getObjectStream({ key, filePath });
  return streamToBuffer(stream instanceof Readable || stream?.[Symbol.asyncIterator] ? stream : Readable.from(stream));
}

export async function deleteObject({ key, filePath }) {
  assertObjectStorageProductionSafe();
  const safeKey = key ? assertRelativeSafeKey(key) : null;
  try {
    if (env.STORAGE_PROVIDER === "local") {
      const target = filePath ? path.resolve(String(filePath)) : localPathForKey(safeKey);
      if (!target.startsWith(`${LOCAL_EXPORT_ROOT}${path.sep}`)) {
        const error = new Error("Unsafe local storage path");
        error.code = "PATH_TRAVERSAL_BLOCKED";
        throw error;
      }
      await fsp.rm(target, { force: true });
      return { provider: "local", deleted: true, missingOk: true };
    }

    if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      await client.send(new DeleteObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey }));
      return { provider: env.STORAGE_PROVIDER, deleted: true, missingOk: true };
    }
  } catch (error) {
    recordStorageError(env.STORAGE_PROVIDER, "deleteObject");
    logger.error({ type: "storage_error", operation: "deleteObject", provider: env.STORAGE_PROVIDER, errorCode: error?.code, message: error?.message, key: safeKey });
    throw error;
  }

  const error = new Error(`${env.STORAGE_PROVIDER} object storage delete is not implemented yet`);
  error.code = "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED";
  throw error;
}

/**
 * Lists everything stored under one key prefix, newest first.
 *
 * Retention for tenant artifacts is driven from the BackupArtifact table, but a
 * database-level dump has no row behind it — the bucket is the only record that
 * it exists. Pruning those needs a listing, so this is the one storage read that
 * answers "what is actually in there?" rather than "give me this exact key".
 */
export async function listObjects({ prefix }) {
  assertObjectStorageProductionSafe();
  const safePrefix = assertRelativeSafeKey(prefix);
  const newestFirst = (a, b) => (b.lastModified?.getTime() ?? 0) - (a.lastModified?.getTime() ?? 0);
  try {
    if (env.STORAGE_PROVIDER === "local") {
      const root = localPathForKey(safePrefix);
      const entries = [];
      const walk = async (dir) => {
        let dirents;
        try {
          dirents = await fsp.readdir(dir, { withFileTypes: true });
        } catch (error) {
          // Nothing has been uploaded under this prefix yet. An empty listing is
          // the honest answer; a throw here would read as a storage failure.
          if (error?.code === "ENOENT") return;
          throw error;
        }
        for (const dirent of dirents) {
          const full = path.join(dir, dirent.name);
          if (dirent.isDirectory()) {
            await walk(full);
            continue;
          }
          const stat = await fsp.stat(full);
          entries.push({
            key: path.posix.join(safePrefix, path.relative(root, full).split(path.sep).join("/")),
            sizeBytes: stat.size,
            lastModified: stat.mtime,
          });
        }
      };
      await walk(root);
      return entries.sort(newestFirst);
    }

    if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      const { ListObjectsV2Command } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      const entries = [];
      let continuationToken;
      // Paginate. A truncated first page silently under-reports what is in the
      // bucket, which would make a retention sweep believe it has fewer copies
      // than it does.
      do {
        const page = await client.send(new ListObjectsV2Command({
          Bucket: env.STORAGE_BUCKET,
          Prefix: `${safePrefix}/`,
          ContinuationToken: continuationToken,
        }));
        for (const object of page.Contents || []) {
          entries.push({
            key: object.Key,
            sizeBytes: Number(object.Size || 0),
            lastModified: object.LastModified ? new Date(object.LastModified) : null,
          });
        }
        continuationToken = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (continuationToken);
      return entries.sort(newestFirst);
    }
  } catch (error) {
    recordStorageError(env.STORAGE_PROVIDER, "listObjects");
    logger.error({ type: "storage_error", operation: "listObjects", provider: env.STORAGE_PROVIDER, errorCode: error?.code, message: error?.message, key: safePrefix });
    throw error;
  }

  const error = new Error(`${env.STORAGE_PROVIDER} object storage listing is not implemented yet`);
  error.code = "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED";
  throw error;
}

export async function getSignedDownloadUrl({ key, expiresInSeconds = env.EXPORT_SIGNED_URL_TTL_SECONDS }) {
  assertObjectStorageProductionSafe();
  const safeKey = assertRelativeSafeKey(key);
  const ttl = Math.min(Math.max(Number(expiresInSeconds || 300), 30), 3600);

  if (env.STORAGE_PROVIDER === "local") {
    const error = new Error("Signed URL is not supported for local storage; use backend-protected downloads");
    error.code = "SIGNED_URL_NOT_SUPPORTED_FOR_LOCAL_STORAGE";
    throw error;
  }

  if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
    try {
      const { GetObjectCommand } = await import("@aws-sdk/client-s3");
      const { getSignedUrl } = await import("@aws-sdk/s3-request-presigner");
      const client = await getS3Client();
      return getSignedUrl(client, new GetObjectCommand({ Bucket: env.STORAGE_BUCKET, Key: safeKey }), { expiresIn: ttl });
    } catch (error) {
      recordStorageError(env.STORAGE_PROVIDER, "getSignedDownloadUrl");
      logger.error({ type: "storage_error", operation: "getSignedDownloadUrl", provider: env.STORAGE_PROVIDER, errorCode: error?.code, message: error?.message, key: safeKey });
      throw error;
    }
  }

  const error = new Error(`${env.STORAGE_PROVIDER} signed URL adapter is not implemented yet`);
  error.code = "OBJECT_STORAGE_PROVIDER_NOT_IMPLEMENTED";
  throw error;
}

export async function checkStorageHealth() {
  try {
    assertObjectStorageProductionSafe();
    if (env.STORAGE_PROVIDER === "local") {
      await fsp.mkdir(LOCAL_EXPORT_ROOT, { recursive: true });
      await fsp.access(LOCAL_EXPORT_ROOT, fs.constants.W_OK);
      return { status: "ok", provider: "local", publicDownloadsEnabled: env.EXPORT_DOWNLOADS_PUBLIC };
    }

    if (S3_COMPATIBLE_PROVIDERS.has(env.STORAGE_PROVIDER)) {
      const { HeadBucketCommand } = await import("@aws-sdk/client-s3");
      const client = await getS3Client();
      await client.send(new HeadBucketCommand({ Bucket: env.STORAGE_BUCKET }));
      return { status: "ok", provider: env.STORAGE_PROVIDER, bucketConfigured: true };
    }
  } catch (error) {
    recordStorageError(env.STORAGE_PROVIDER, "checkStorageHealth");
    return { status: "error", provider: env.STORAGE_PROVIDER, errorCode: error?.code ?? "STORAGE_HEALTH_ERROR", message: error?.message };
  }
  return { status: "disabled", provider: env.STORAGE_PROVIDER };
}

export function logObjectStorageConfigSafe() {
  return {
    provider: env.STORAGE_PROVIDER,
    bucket: env.STORAGE_BUCKET ? maskStorageValue(env.STORAGE_BUCKET) : null,
    endpoint: env.STORAGE_ENDPOINT ? "[CONFIGURED]" : null,
    accessKeyId: env.STORAGE_ACCESS_KEY_ID ? maskStorageValue(env.STORAGE_ACCESS_KEY_ID) : null,
    secretAccessKey: env.STORAGE_SECRET_ACCESS_KEY ? "[REDACTED]" : null,
    signedUrlTtlSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS,
  };
}

export const __objectStorageInternals = {
  LOCAL_EXPORT_ROOT,
  CLOUD_PROVIDERS,
  S3_COMPATIBLE_PROVIDERS,
  assertRelativeSafeKey,
  localPathForKey,
  maskStorageValue,
  requireCloudConfig,
};
