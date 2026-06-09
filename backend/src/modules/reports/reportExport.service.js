import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { env } from "../../config/env.js";
import { addJob, isQueueEnabled } from "../../lib/queue.js";
import { QUEUE_NAMES, JOB_NAMES } from "../../workers/queueNames.js";
import { writeExportFile, deleteExportFile } from "../../lib/fileStorage.js";
import { recordExportJob } from "../../lib/metrics.js";
import { createAuditLog } from "../audit/audit.service.js";
import {
  exportBillsData,
  exportStockLedgerData,
  exportUdharData,
  getDailyClosing,
  getSalesSummary,
} from "./reports.service.js";

export const REPORT_EXPORT_TYPES = Object.freeze([
  "bills_csv",
  "stock_csv",
  "udhar_csv",
  "daily_closing_csv",
  "sales_summary_csv",
]);

const SAFE_PARAM_KEYS = new Set([
  "from",
  "to",
  "date",
  "range",
  "status",
  "productId",
  "limit",
]);

function appError(message, statusCode, code) {
  const err = new AppError(message, statusCode);
  err.code = code;
  return err;
}

export function sanitizeExportParams(params = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(params || {})) {
    if (!SAFE_PARAM_KEYS.has(key)) continue;
    if (value === undefined || value === null || value === "") continue;
    safe[key] = typeof value === "string" || typeof value === "number" || typeof value === "boolean"
      ? value
      : String(value);
  }
  return safe;
}

function assertReportType(reportType) {
  if (!REPORT_EXPORT_TYPES.includes(reportType)) {
    throw appError("Unsupported report export type", 400, "UNSUPPORTED_REPORT_EXPORT_TYPE");
  }
  return reportType;
}

function defaultExpiry() {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + Number(env.JOB_RETENTION_DAYS || 7));
  return expiresAt;
}

function safeJob(job) {
  if (!job) return null;
  return {
    id: job.id,
    shopId: job.shopId,
    requestedByUserId: job.requestedByUserId,
    reportType: job.reportType,
    status: job.status,
    params: parseParams(job.paramsJson),
    fileName: job.fileName ?? null,
    fileUrl: job.fileUrl ?? null,
    mimeType: job.mimeType ?? null,
    sizeBytes: job.sizeBytes ?? null,
    error: job.error ?? null,
    requestedAt: job.requestedAt?.toISOString?.() ?? job.requestedAt,
    startedAt: job.startedAt?.toISOString?.() ?? null,
    completedAt: job.completedAt?.toISOString?.() ?? null,
    expiresAt: job.expiresAt?.toISOString?.() ?? null,
    createdAt: job.createdAt?.toISOString?.() ?? job.createdAt,
    updatedAt: job.updatedAt?.toISOString?.() ?? job.updatedAt,
    ready: job.status === "completed",
  };
}

function parseParams(raw) {
  try {
    const parsed = JSON.parse(raw || "{}");
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export async function createReportExportJob(shopId, userId, reportType, params = {}) {
  if (!shopId || !userId) throw appError("shopId and userId are required", 400, "INVALID_EXPORT_JOB_CONTEXT");
  const type = assertReportType(reportType);
  const safeParams = sanitizeExportParams(params);
  const job = await db.reportExportJob.create({
    data: {
      shopId,
      requestedByUserId: userId,
      reportType: type,
      status: "queued",
      paramsJson: JSON.stringify(safeParams),
      requestedAt: new Date(),
      expiresAt: defaultExpiry(),
    },
  });
  recordExportJob("queued");
  return safeJob(job);
}

export async function createAndEnqueueReportExportJob(shopId, userId, reportType, params = {}) {
  if (!isQueueEnabled()) {
    throw appError("Report export queue is disabled", 503, "JOB_QUEUE_DISABLED");
  }
  const job = await createReportExportJob(shopId, userId, reportType, params);
  const queueResult = await addJob(QUEUE_NAMES.exportsQueue, JOB_NAMES.GENERATE_REPORT_EXPORT, {
    exportJobId: job.id,
    shopId,
    userId,
    reportType: job.reportType,
    requestedAt: new Date().toISOString(),
  }, { jobId: `report-export:${job.id}` });

  if (!queueResult.success) {
    await markReportExportFailed(job.id, queueResult.code || "JOB_QUEUE_UNAVAILABLE");
    throw appError("Report export queue is unavailable", 503, queueResult.code || "JOB_QUEUE_UNAVAILABLE");
  }

  await createAuditLog({
    shopId,
    userId,
    action: "REPORT_EXPORT_JOB_CREATED",
    entityType: "ReportExportJob",
    entityId: job.id,
    metadata: { reportType: job.reportType, params: job.params, queued: true },
  });

  return { ...job, queued: true, queueJobId: queueResult.jobId };
}

export async function getReportExportJob(shopId, jobId) {
  const job = await db.reportExportJob.findFirst({ where: { id: jobId, shopId } });
  return safeJob(job);
}

export async function getReportExportJobForDownload(shopId, jobId) {
  const job = await db.reportExportJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) throw appError("Report export job not found", 404, "REPORT_EXPORT_JOB_NOT_FOUND");
  if (job.status !== "completed") throw appError("Report export file is not ready", 409, "REPORT_EXPORT_NOT_READY");
  if (!job.filePath) throw appError("Report export file is missing", 404, "REPORT_EXPORT_FILE_MISSING");
  return job;
}

export async function listReportExportJobs(shopId, filters = {}) {
  const where = {
    shopId,
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.reportType ? { reportType: filters.reportType } : {}),
  };
  const jobs = await db.reportExportJob.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(filters.limit || 50), 1), 100),
  });
  return jobs.map(safeJob);
}

export async function markReportExportProcessing(jobId) {
  recordExportJob("processing");
  return db.reportExportJob.update({
    where: { id: jobId },
    data: { status: "processing", startedAt: new Date(), error: null },
  });
}

export async function markReportExportCompleted(jobId, fileMetadata = {}) {
  recordExportJob("completed");
  return db.reportExportJob.update({
    where: { id: jobId },
    data: {
      status: "completed",
      fileName: fileMetadata.fileName ?? null,
      filePath: fileMetadata.filePath ?? null,
      fileUrl: fileMetadata.fileUrl ?? `/api/reports/exports/${jobId}/download`,
      mimeType: fileMetadata.mimeType ?? "text/csv; charset=utf-8",
      sizeBytes: fileMetadata.sizeBytes ?? null,
      completedAt: new Date(),
      error: null,
    },
  });
}

export async function markReportExportFailed(jobId, error) {
  recordExportJob("failed");
  const message = typeof error === "string" ? error : error?.code || error?.message || "REPORT_EXPORT_FAILED";
  return db.reportExportJob.update({
    where: { id: jobId },
    data: { status: "failed", error: message.slice(0, 500), completedAt: new Date() },
  }).catch(() => null);
}

export async function cancelReportExportJob(shopId, jobId, userId) {
  const job = await db.reportExportJob.findFirst({ where: { id: jobId, shopId } });
  if (!job) throw appError("Report export job not found", 404, "REPORT_EXPORT_JOB_NOT_FOUND");
  if (["completed", "failed", "cancelled"].includes(job.status)) {
    return safeJob(job);
  }
  recordExportJob("cancelled");
  const updated = await db.reportExportJob.update({
    where: { id: jobId },
    data: { status: "cancelled", completedAt: new Date(), error: "Cancelled by user" },
  });
  await createAuditLog({
    shopId,
    userId,
    action: "REPORT_EXPORT_JOB_CANCELLED",
    entityType: "ReportExportJob",
    entityId: jobId,
    metadata: { reportType: job.reportType, status: "cancelled" },
  });
  return safeJob(updated);
}

export async function cleanupExpiredReportExports({ now = new Date(), limit = 100 } = {}) {
  const jobs = await db.reportExportJob.findMany({
    where: {
      status: "completed",
      expiresAt: { lt: now },
    },
    orderBy: { expiresAt: "asc" },
    take: Math.min(Math.max(Number(limit || 100), 1), 500),
  });

  const results = [];
  for (const job of jobs) {
    try {
      if (job.filePath) await deleteExportFile(job.filePath);
      const updated = await db.reportExportJob.update({
        where: { id: job.id },
        data: {
          status: "cancelled",
          filePath: null,
          fileUrl: null,
          error: "Expired export file cleaned up",
          completedAt: job.completedAt ?? new Date(),
        },
      });
      await createAuditLog({
        shopId: job.shopId,
        userId: job.requestedByUserId,
        action: "REPORT_EXPORT_JOB_EXPIRED_CLEANED",
        entityType: "ReportExportJob",
        entityId: job.id,
        metadata: { reportType: job.reportType, expiresAt: job.expiresAt, status: updated.status },
      });
      results.push({ jobId: job.id, cleaned: true });
    } catch (error) {
      await markReportExportFailed(job.id, error);
      results.push({ jobId: job.id, cleaned: false, errorCode: error?.code ?? "EXPORT_CLEANUP_FAILED" });
    }
  }
  return { status: "completed", checked: jobs.length, cleaned: results.filter((r) => r.cleaned).length, results };
}

export async function processReportExportJob(exportJobId) {
  const job = await db.reportExportJob.findUnique({ where: { id: exportJobId } });
  if (!job) throw appError("Report export job not found", 404, "REPORT_EXPORT_JOB_NOT_FOUND");
  if (job.status === "cancelled") return { status: "cancelled", exportJobId };
  if (job.status === "completed") return { status: "already_completed", exportJobId, fileUrl: job.fileUrl };

  await markReportExportProcessing(job.id);
  await createAuditLog({
    shopId: job.shopId,
    userId: job.requestedByUserId,
    action: "REPORT_EXPORT_JOB_STARTED",
    entityType: "ReportExportJob",
    entityId: job.id,
    metadata: { reportType: job.reportType },
  });

  try {
    const params = parseParams(job.paramsJson);
    const csv = await buildReportCsv(job.shopId, job.reportType, params);
    const fileMetadata = await writeExportFile({
      shopId: job.shopId,
      jobId: job.id,
      reportType: job.reportType,
      content: csv,
    });
    const completed = await markReportExportCompleted(job.id, fileMetadata);
    await createAuditLog({
      shopId: job.shopId,
      userId: job.requestedByUserId,
      action: "REPORT_EXPORT_JOB_COMPLETED",
      entityType: "ReportExportJob",
      entityId: job.id,
      metadata: { reportType: job.reportType, sizeBytes: fileMetadata.sizeBytes, fileName: fileMetadata.fileName },
    });
    return { status: "completed", exportJobId: job.id, fileName: completed.fileName, fileUrl: completed.fileUrl };
  } catch (error) {
    await markReportExportFailed(job.id, error);
    await createAuditLog({
      shopId: job.shopId,
      userId: job.requestedByUserId,
      action: "REPORT_EXPORT_JOB_FAILED",
      entityType: "ReportExportJob",
      entityId: job.id,
      metadata: { reportType: job.reportType, errorCode: error?.code ?? "REPORT_EXPORT_FAILED" },
    });
    throw error;
  }
}

async function buildReportCsv(shopId, reportType, params) {
  switch (reportType) {
    case "bills_csv": {
      const data = await exportBillsData(shopId, params);
      return rowsToCsv(data.rows ?? []);
    }
    case "stock_csv": {
      const rows = await exportStockLedgerData(shopId, params);
      return rowsToCsv(rows);
    }
    case "udhar_csv": {
      const rows = await exportUdharData(shopId);
      return rowsToCsv(rows.flatMap((customer) => customer.entries?.length
        ? customer.entries.map((entry) => ({ customerId: customer.id, customerName: customer.name, outstandingBalance: customer.outstandingBalance, ...entry }))
        : [{ customerId: customer.id, customerName: customer.name, outstandingBalance: customer.outstandingBalance }]));
    }
    case "daily_closing_csv": {
      const row = await getDailyClosing(shopId, { date: params.date || params.from });
      return rowsToCsv([flattenReportRow(row)]);
    }
    case "sales_summary_csv": {
      const row = await getSalesSummary(shopId, { ...params, includeProfit: false });
      const dailyRows = (row.dailyBreakdown ?? []).map((d) => ({ section: "dailyBreakdown", ...d }));
      return rowsToCsv([flattenReportRow({ section: "summary", ...row }), ...dailyRows]);
    }
    default:
      throw appError("Unsupported report export type", 400, "UNSUPPORTED_REPORT_EXPORT_TYPE");
  }
}

function flattenReportRow(row = {}) {
  const flat = {};
  for (const [key, value] of Object.entries(row)) {
    if (Array.isArray(value) || (value && typeof value === "object")) flat[key] = JSON.stringify(value);
    else flat[key] = value;
  }
  return flat;
}

export function rowsToCsv(rows = []) {
  if (!rows.length) return "";
  const headers = [...new Set(rows.flatMap((row) => Object.keys(row)))];
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((header) => escapeCsv(row[header])).join(","));
  }
  return `${lines.join("\n")}\n`;
}

function escapeCsv(value) {
  if (value === null || value === undefined) return "";
  const raw = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

export const __reportExportInternals = { sanitizeExportParams, rowsToCsv, buildReportCsv, safeJob, cleanupExpiredReportExports };
