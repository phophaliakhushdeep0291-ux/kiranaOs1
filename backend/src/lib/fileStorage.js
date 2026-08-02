import path from "path";
import { env } from "../config/env.js";
import { putObject, getObject, getObjectStream, deleteObject, getSignedDownloadUrl } from "./objectStorage.js";

const EXPORT_ROOT = path.resolve(process.cwd(), "storage", "exports");
const SAFE_REPORT_TYPES = new Set([
  "bills_csv",
  "stock_csv",
  "udhar_csv",
  "daily_closing_csv",
  "sales_summary_csv",
  // §9 "Generate PDF and Excel reports automatically".
  "gst_summary_pdf",
  "customer_outstanding_pdf",
  "customer_outstanding_xlsx",
  "bills_xlsx",
  "stock_xlsx",
  "sales_summary_xlsx",
]);
const CSV_MIME_TYPE = "text/csv; charset=utf-8";

/**
 * The export format is encoded in the report type's suffix, so a new report only
 * has to be added to SAFE_REPORT_TYPES to get the right extension and MIME type
 * through storage, download headers and the job record.
 */
const FORMATS = Object.freeze({
  csv: { extension: "csv", mimeType: CSV_MIME_TYPE, binary: false },
  pdf: { extension: "pdf", mimeType: "application/pdf", binary: true },
  xlsx: {
    extension: "xlsx",
    mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    binary: true,
  },
});

export function exportFormatFor(reportType) {
  const type = validateReportType(reportType);
  const suffix = type.slice(type.lastIndexOf("_") + 1);
  return FORMATS[suffix] ?? FORMATS.csv;
}

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
  return `${type}-${safeJobId}.${exportFormatFor(type).extension}`;
}

export function buildExportStorageKey({ shopId, jobId, reportType }) {
  const safeShopId = assertSafeId(shopId, "shopId");
  const safeJobId = assertSafeId(jobId, "jobId");
  validateReportType(reportType);
  // Server-generated key only. Never use a user-provided filename.
  return `exports/${safeShopId}/${safeJobId}.${exportFormatFor(reportType).extension}`;
}

export function buildExportFilePath({ shopId, jobId, reportType }) {
  // Kept for backward-compatible static checks and local filesystem safety.
  const safeShopId = assertSafeId(shopId, "shopId");
  const safeJobId = assertSafeId(jobId, "jobId");
  const fileName = buildExportFileName(reportType, safeJobId);
  const format = exportFormatFor(reportType);
  const dir = path.join(EXPORT_ROOT, "exports", safeShopId);
  const filePath = path.join(dir, `${safeJobId}.${format.extension}`);
  const resolved = path.resolve(filePath);
  if (!resolved.startsWith(`${EXPORT_ROOT}${path.sep}`)) {
    const error = new Error("Unsafe export file path");
    error.code = "PATH_TRAVERSAL_BLOCKED";
    throw error;
  }
  return { dir, filePath: resolved, fileName, mimeType: format.mimeType };
}

export async function writeExportFile({ shopId, jobId, reportType, content }) {
  const key = buildExportStorageKey({ shopId, jobId, reportType });
  const fileName = buildExportFileName(reportType, jobId);
  const format = exportFormatFor(reportType);
  const result = await putObject({
    key,
    // Binary formats (PDF/XLSX) must not be stringified — that would corrupt them.
    body: format.binary ? content : String(content ?? ""),
    contentType: format.mimeType,
    metadata: { reportType: validateReportType(reportType), jobId: assertSafeId(jobId, "jobId") },
  });
  return {
    fileName,
    // Existing DB column is filePath; for cloud providers this stores the object key/fileKey, not a filesystem path.
    filePath: result.filePath ?? result.key ?? key,
    fileUrl: env.EXPORT_DOWNLOADS_PUBLIC && env.STORAGE_PUBLIC_BASE_URL
      ? `${String(env.STORAGE_PUBLIC_BASE_URL).replace(/\/$/, "")}/${key}`
      : `/api/reports/exports/${jobId}/download`,
    mimeType: format.mimeType,
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
