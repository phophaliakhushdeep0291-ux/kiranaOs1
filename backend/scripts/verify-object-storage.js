#!/usr/bin/env node
import crypto from "crypto";

process.env.DATABASE_URL ||= "file:./prisma/dev.db";
process.env.JWT_SECRET ||= "storage-verify-jwt-secret-32-characters-minimum";
process.env.NODE_ENV ||= "development";

const { env } = await import("../src/config/env.js");
const {
  putObject,
  getObject,
  deleteObject,
  getSignedDownloadUrl,
  checkStorageHealth,
  logObjectStorageConfigSafe,
} = await import("../src/lib/objectStorage.js");
const { redactSensitive } = await import("../src/lib/logger.js");

function log(payload) {
  console.log(JSON.stringify(redactSensitive(payload)));
}

async function main() {
  if (env.NODE_ENV === "production" && process.env.ALLOW_PRODUCTION_STORAGE_VERIFY !== "true") {
    throw new Error("Refusing production storage verification unless ALLOW_PRODUCTION_STORAGE_VERIFY=true");
  }

  const key = `storage-healthcheck/${Date.now()}-${crypto.randomBytes(6).toString("hex")}.txt`;
  const body = `kiranaos-storage-healthcheck ${new Date().toISOString()} ${crypto.randomBytes(8).toString("hex")}`;

  log({ type: "storage_verify_start", provider: env.STORAGE_PROVIDER, config: logObjectStorageConfigSafe(), keyPrefix: "storage-healthcheck/" });

  const healthBefore = await checkStorageHealth();
  if (healthBefore.status === "error") {
    const error = new Error(`Storage health failed before upload: ${healthBefore.errorCode || healthBefore.message}`);
    error.code = healthBefore.errorCode || "STORAGE_HEALTH_FAILED";
    throw error;
  }

  const uploaded = await putObject({
    key,
    body,
    contentType: "text/plain; charset=utf-8",
    metadata: { purpose: "kiranaos-storage-healthcheck" },
  });
  log({ type: "storage_verify_uploaded", provider: uploaded.provider, key, sizeBytes: uploaded.sizeBytes });

  const downloaded = await getObject({ key });
  const text = downloaded.toString("utf8");
  if (text !== body) throw new Error("Downloaded object did not match uploaded object");
  log({ type: "storage_verify_read_back", key, bytes: downloaded.length });

  if (env.STORAGE_PROVIDER !== "local") {
    const signedUrl = await getSignedDownloadUrl({ key, expiresInSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS });
    if (!/^https?:\/\//.test(signedUrl)) throw new Error("Signed URL was not an HTTP URL");
    log({ type: "storage_verify_signed_url", key, signedUrlGenerated: true, ttlSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS });

    const res = await fetch(signedUrl);
    if (!res.ok) throw new Error(`Signed URL download failed with ${res.status}`);
    const signedText = await res.text();
    if (signedText !== body) throw new Error("Signed URL object content mismatch");
    log({ type: "storage_verify_signed_url_read", key, status: res.status });
  } else {
    log({ type: "storage_verify_signed_url_skipped", reason: "local provider uses backend-protected downloads" });
  }

  await deleteObject({ key });
  log({ type: "storage_verify_deleted", key });

  try {
    await getObject({ key });
    throw new Error("Object still readable after delete");
  } catch (error) {
    if (error.message === "Object still readable after delete") throw error;
    log({ type: "storage_verify_cleanup_confirmed", key, deleted: true, missingAfterDelete: true });
  }

  log({ type: "storage_verify_passed", provider: env.STORAGE_PROVIDER, time: new Date().toISOString() });
}

main().catch((error) => {
  console.error(JSON.stringify(redactSensitive({ type: "storage_verify_failed", errorCode: error.code, message: error.message })));
  process.exit(1);
});
