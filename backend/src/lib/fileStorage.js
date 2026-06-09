import path from "path";
import { env } from "../config/env.js";
import { putObject, getObject, getObjectStream, deleteObject, getSignedDownloadUrl } from "./objectStorage.js";

const EXPORT_ROOT = path.resolve(process.cwd(), "storage", "exports");
const SAFE_REPORT_TYPES = new Set(["bills_csv", "stock_csv", "udhar_csv", "daily_closing_csv", "sales_summary_csv"]);
const CSV_MIME_TYPE = "text/csv; charset=utf-8";

function assertSafeId(value, label) {
  const raw = String(value || "").trim();
  if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
    const error = new Error(`${label} contains unsafe characters`);
    error.code = "UNSAFE_FILE_IDENTIFIER";
    throw error;
  }
  return raw;
}

export function validateReportType(reportType) {
  const type = String(reportType || "").trim();
  if (!SAFE_REPORT_TYPES.has(type)) {
    const error = new Error("Unsupported report export type");
    error.code = "UNSUPPORTED_REPORT_EXPORT_TYPE";
    throw error;
  }
  return type;
}

export function buildExportFileName(reportType, jobId) {
  const type = validateReportType(reportType);
  const safeJobId = assertSafeId(jobId, "jobId");
  return `${type}-${safeJobId}.csv`;
}

export function buildExportStorageKey({ shopId, jobId, reportType }) {
  const safeShopId = assertSafeId(shopId, "shopId");
  const safeJobId = assertSafeId(jobId, "jobId");
  validateReportType(reportType);
  // Server-generated key only. Never use a user-provided filename.
  return `exports/${safeShopId}/${safeJobId}.csv`;
}

export function buildExportFilePath({ shopId, jobId, reportType }) {
  // Kept for backward-compatible static checks and local filesystem safety.
  const safeShopId = assertSafeId(shopId, "shopId");
  const safeJobId = assertSafeId(jobId, "jobId");
  const fileName = buildExportFileName(reportType, safeJobId);
  const dir = path.join(EXPORT_ROOT, "exports", safeShopId);
  const filePath = path.join(dir, `${safeJobId}.csv`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${EXPORT_ROOT}${path.sep}`)) {
    const error = new Error("Unsafe export file path");
    error.code = "PATH_TRAVERSAL_BLOCKED";
    throw error;
  }
  return { dir, filePath: resolved, fileName, mimeType: CSV_MIME_TYPE };
}

export async function writeExportFile({ shopId, jobId, reportType, content }) {
  const key = buildExportStorageKey({ shopId, jobId, reportType });
  const fileName = buildExportFileName(reportType, jobId);
  const result = await putObject({
    key,
    body: String(content ?? ""),
    contentType: CSV_MIME_TYPE,
    metadata: { reportType: validateReportType(reportType), jobId: assertSafeId(jobId, "jobId") },
  });
  return {
    fileName,
    // Existing DB column is filePath; for cloud providers this stores the object key/fileKey, not a filesystem path.
    filePath: result.filePath ?? result.key ?? key,
    fileUrl: env.EXPORT_DOWNLOADS_PUBLIC && env.STORAGE_PUBLIC_BASE_URL
      ? `${String(env.STORAGE_PUBLIC_BASE_URL).replace(/\/$/, "")}/${key}`
      : `/api/reports/exports/${jobId}/download`,
    mimeType: CSV_MIME_TYPE,
    sizeBytes: result.sizeBytes ?? null,
    storageKey: key,
    storageProvider: result.provider,
  };
}

export async function readExportFile(filePathOrKey) {
  const raw = String(filePathOrKey || "");
  if (raw.includes(path.sep) && path.isAbsolute(raw)) return getObject({ filePath: raw });
  return getObject({ key: raw });
}

export async function streamExportFile(filePathOrKey) {
  const raw = String(filePathOrKey || "");
  if (raw.includes(path.sep) && path.isAbsolute(raw)) return getObjectStream({ filePath: raw });
  return getObjectStream({ key: raw });
}

export async function getExportSignedDownloadUrl(filePathOrKey) {
  const raw = String(filePathOrKey || "");
  if (!raw || (raw.includes(path.sep) && path.isAbsolute(raw))) {
    const error = new Error("Signed URL requires an object storage key");
    error.code = "SIGNED_URL_REQUIRES_OBJECT_KEY";
    throw error;
  }
  return getSignedDownloadUrl({ key: raw, expiresInSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS });
}

export async function deleteExportFile(filePathOrKey) {
  const raw = String(filePathOrKey || "");
  if (!raw) return { deleted: false };
  if (raw.includes(path.sep) && path.isAbsolute(raw)) return deleteObject({ filePath: raw });
  return deleteObject({ key: raw });
}

export const __fileStorageInternals = {
  EXPORT_ROOT,
  SAFE_REPORT_TYPES,
  assertSafeId,
  buildExportFilePath,
  buildExportStorageKey,
};
