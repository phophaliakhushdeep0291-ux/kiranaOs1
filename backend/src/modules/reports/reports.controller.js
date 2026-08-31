import * as svc from "./reports.service.js";
import * as snapshotSvc from "./dailyClosingSnapshot.service.js";
import * as exportSvc from "./reportExport.service.js";
import { getExportSignedDownloadUrl, streamExportFile } from "../../lib/fileStorage.js";
import { env } from "../../config/env.js";
import { createAuditLog } from "../audit/audit.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

function scopedQuery(req, extra = {}) {
  return { ...req.query, locationId: requestLocationId(req), allLocations: req.locationScopeAll === true, ...extra };
}

function canViewProfit(req) {
  return ["owner", "admin"].includes(req.user?.role);
}

export async function dailyClosing(req, res, next) {
  try {
    const source = req.query?.source ?? "auto";
    const date = req.query?.date;

    // Consolidated scope is computed live. Branch snapshots have independent
    // lock/audit lifecycles and must not be silently presented as an all-store close.
    if (req.locationScopeAll === true) {
      return res.json({ success: true, data: await svc.getDailyClosing(req.shopId, scopedQuery(req)) });
    }

    if (source === "live") {
      return res.json({ success: true, data: await svc.getDailyClosing(req.shopId, scopedQuery(req)) });
    }

    if (source === "snapshot") {
      const snapshot = await snapshotSvc.getDailyClosingSnapshot(req.shopId, date, requestLocationId(req));
      if (!snapshot) {
        const err = new Error("Daily closing snapshot not found");
        err.statusCode = 404;
        err.code = "DAILY_CLOSING_SNAPSHOT_NOT_FOUND";
        throw err;
      }
      return res.json({ success: true, data: snapshot });
    }

    // Default: locked snapshot is authoritative for a closed day; otherwise live report remains source of truth.
    const snapshot = date ? await snapshotSvc.getDailyClosingSnapshot(req.shopId, date, requestLocationId(req)) : null;
    if (snapshot?.snapshot?.lockedAt) {
      return res.json({ success: true, data: snapshot });
    }

    return res.json({ success: true, data: await svc.getDailyClosing(req.shopId, scopedQuery(req)) });
  }
  catch (err) { next(err); }
}

export async function createDailyClosingSnapshot(req, res, next) {
  try {
    const data = await snapshotSvc.refreshDailyClosingSnapshot(req.shopId, req.body.date, {
      source: "manual",
      userId: req.user?.userId ?? null,
      storeId: requestLocationId(req),
    });
    res.status(201).json({ success: true, data });
  }
  catch (err) { next(err); }
}

export async function listDailyClosingDrawerCounts(req, res, next) {
  try {
    const data = await snapshotSvc.listDailyClosingDrawerCounts(req.shopId, {
      from: req.query.from,
      to: req.query.to,
      storeId: requestLocationId(req),
    });
    res.json({ success: true, data });
  }
  catch (err) { next(err); }
}

export async function lockDailyClosingSnapshot(req, res, next) {
  try {
    const data = await snapshotSvc.lockDailyClosingSnapshot(req.shopId, req.params.date, req.user?.userId ?? null, requestLocationId(req));
    res.json({ success: true, data });
  }
  catch (err) { next(err); }
}

export async function overrideRefreshDailyClosingSnapshot(req, res, next) {
  try {
    const data = await snapshotSvc.overrideRefreshDailyClosingSnapshot(req.shopId, req.params.date, {
      userId: req.user?.userId ?? null,
      reason: req.body.reason,
      source: "manual",
      storeId: requestLocationId(req),
    });
    res.json({ success: true, data });
  }
  catch (err) { next(err); }
}

export async function salesSummary(req, res, next) {
  try { res.json({ success: true, data: await svc.getSalesSummary(req.shopId, scopedQuery(req, { includeProfit: canViewProfit(req) })) }); }
  catch (err) { next(err); }
}

export async function paymentModes(req, res, next) {
  try { res.json({ success: true, data: await svc.getPaymentModeReport(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}

export async function udharAgeing(req, res, next) {
  try { res.json({ success: true, data: await svc.getUdharAgeing(req.shopId) }); }
  catch (err) { next(err); }
}

export async function inventoryHealth(req, res, next) {
  try { res.json({ success: true, data: await svc.getInventoryHealth(req.shopId, scopedQuery(req, { includeCost: canViewProfit(req) })) }); }
  catch (err) { next(err); }
}

export async function staffSales(req, res, next) {
  try { res.json({ success: true, data: await svc.getStaffSales(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}

export async function pnl(req, res, next) {
  try { res.json({ success: true, data: await svc.getPnL(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}
export async function gstReport(req, res, next) {
  try { res.json({ success: true, data: await svc.getGstReport(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}
export async function monthlyBreakdown(req, res, next) {
  try { res.json({ success: true, data: await svc.getMonthlyBreakdown(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}
export async function topProducts(req, res, next) {
  try { res.json({ success: true, data: await svc.getTopProducts(req.shopId, scopedQuery(req, { includeProfit: canViewProfit(req) })) }); }
  catch (err) { next(err); }
}
export async function paymentSummary(req, res, next) {
  try { res.json({ success: true, data: await svc.getPaymentSummary(req.shopId, scopedQuery(req)) }); }
  catch (err) { next(err); }
}
export async function financialLedgerReconciliation(req, res, next) {
  try { res.json({ success: true, data: await svc.getFinancialLedgerReconciliation(req.shopId) }); }
  catch (err) { next(err); }
}
export async function exportBills(req, res, next) {
  try {
    const data = await svc.exportBillsData(req.shopId, scopedQuery(req));
    await logDataExport(req, "bills", { rowCount: data.rows?.length ?? 0, billCount: data.count ?? 0 });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
export async function exportStock(req, res, next) {
  try {
    const data = await svc.exportStockLedgerData(req.shopId, scopedQuery(req));
    await logDataExport(req, "stock", { rowCount: data.count, truncated: data.truncated });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
export async function exportUdhar(req, res, next) {
  try {
    const data = await svc.exportUdharData(req.shopId);
    await logDataExport(req, "udhar", { customerCount: Array.isArray(data) ? data.length : 0 });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function createReportExportJob(req, res, next) {
  try {
    const data = await exportSvc.createAndEnqueueReportExportJob(
      req.shopId,
      req.user?.userId,
      req.body.reportType,
      req.body.params ?? {}
    );
    // `queued` reports how the job is actually being run, not a constant: without
    // Redis it runs inline on this node, and saying otherwise would mislead a
    // client that is deciding whether to poll.
    res.status(202).json({ success: true, data: { jobId: data.id, status: data.status, queued: data.queued !== false, runner: data.runner ?? "queue", queueJobId: data.queueJobId } });
  } catch (err) { next(err); }
}

export async function listReportExportJobs(req, res, next) {
  try {
    res.json({ success: true, data: await exportSvc.listReportExportJobs(req.shopId, req.query) });
  } catch (err) { next(err); }
}

export async function getReportExportJob(req, res, next) {
  try {
    const data = await exportSvc.getReportExportJob(req.shopId, req.params.jobId);
    if (!data) {
      const err = new Error("Report export job not found");
      err.statusCode = 404;
      err.code = "REPORT_EXPORT_JOB_NOT_FOUND";
      throw err;
    }
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function cancelReportExportJob(req, res, next) {
  try {
    const data = await exportSvc.cancelReportExportJob(req.shopId, req.params.jobId, req.user?.userId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

// readExportFile compatibility: protected downloads now use streamExportFile for large exports.
export async function downloadReportExportJob(req, res, next) {
  try {
    const job = await exportSvc.getReportExportJobForDownload(req.shopId, req.params.jobId);

    if (env.EXPORT_DOWNLOADS_PUBLIC && env.STORAGE_PROVIDER !== "local") {
      const signedUrl = await getExportSignedDownloadUrl(job.filePath);
      return res.json({
        success: true,
        data: {
          downloadMode: "signed_url",
          url: signedUrl,
          expiresInSeconds: env.EXPORT_SIGNED_URL_TTL_SECONDS,
          fileName: job.fileName,
          mimeType: job.mimeType,
        },
      });
    }

    const { stream, contentLength } = await streamExportFile(job.filePath);
    res.setHeader("Content-Type", job.mimeType || "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="${job.fileName || `${job.id}.csv`}"`);
    if (contentLength) res.setHeader("Content-Length", contentLength);
    stream.pipe(res);
  } catch (err) { next(err); }
}

async function logDataExport(req, exportType, metadata = {}) {
  await createAuditLog({
    shopId: req.shopId,
    userId: req.user?.userId,
    action: "DATA_EXPORTED",
    entityType: "ReportExport",
    entityId: exportType,
    metadata: { exportType, query: req.query, ...metadata },
    req,
  });
}
