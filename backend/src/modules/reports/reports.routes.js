import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import {
  dailyClosingSchema,
  dailyClosingSnapshotSchema,
  exportListSchema,
  exportReportSchema,
  overrideDailyClosingSnapshotSchema,
  inventoryHealthSchema,
  monthlyBreakdownSchema,
  paymentModesSchema,
  pnlQuerySchema,
  salesSummarySchema,
  staffSalesSchema,
  topProductsSchema,
  udharAgeingSchema,
} from "./reports.schema.js";
import * as ctrl from "./reports.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// Shopkeeper operational dashboard reports. They are shop-scoped and exclude cancelled
// bills; estimates (kacha bills) count as sales everywhere except the GST report.
router.get("/daily-closing", validateQuery(dailyClosingSchema), ctrl.dailyClosing);
router.post("/daily-closing/snapshot", requireRole("owner", "admin"), validate(dailyClosingSnapshotSchema), ctrl.createDailyClosingSnapshot);
router.post("/daily-closing/:date/lock", requireRole("owner", "admin"), ctrl.lockDailyClosingSnapshot);
router.post(
  "/daily-closing/:date/override-refresh",
  requireRole("owner", "admin"),
  requireOwnerPin,
  validate(overrideDailyClosingSnapshotSchema),
  ctrl.overrideRefreshDailyClosingSnapshot
);
router.get("/sales-summary", validateQuery(salesSummarySchema), ctrl.salesSummary);
router.get("/payment-modes", validateQuery(paymentModesSchema), ctrl.paymentModes);
router.get("/udhar-ageing", validateQuery(udharAgeingSchema), ctrl.udharAgeing);
router.get("/top-products", requireRole("owner"), validateQuery(topProductsSchema), ctrl.topProducts);
router.get("/inventory-health", validateQuery(inventoryHealthSchema), ctrl.inventoryHealth);

// Staff-wise sales uses server-trusted Bill.createdByUserId and keeps legacy bills in an Unknown bucket.
router.get("/staff-sales", requireRole("owner", "admin"), validateQuery(staffSalesSchema), ctrl.staffSales);

// Profit/cost-sensitive reports remain owner-only.
router.get("/gst", validateQuery(pnlQuerySchema), ctrl.gstReport);
router.get("/pnl", requireRole("owner"), requireFeature("profit_estimate"), validateQuery(pnlQuerySchema), ctrl.pnl);
router.get("/monthly-breakdown", requireRole("owner"), validateQuery(monthlyBreakdownSchema), ctrl.monthlyBreakdown);

// Backward-compatible existing operational summary.
router.get("/payment-summary", ctrl.paymentSummary);

// Async report export jobs. POST/cancel require owner PIN; list/status/download are owner/admin-only and shop-scoped.
router.post("/exports", requireRole("owner", "admin"), requireOwnerPin, requireFeature("csv_import_export"), validate(exportReportSchema), ctrl.createReportExportJob);
router.get("/exports", requireRole("owner", "admin"), validateQuery(exportListSchema), ctrl.listReportExportJobs);
router.get("/exports/:jobId/download", requireRole("owner", "admin"), ctrl.downloadReportExportJob);
router.get("/exports/:jobId", requireRole("owner", "admin"), ctrl.getReportExportJob);
router.post("/exports/:jobId/cancel", requireRole("owner", "admin"), requireOwnerPin, ctrl.cancelReportExportJob);

// Export endpoints contain sensitive business data.
router.get("/export/bills", requireOwnerPin, ctrl.exportBills);
router.get("/export/stock", requireOwnerPin, ctrl.exportStock);
router.get("/export/udhar", requireOwnerPin, ctrl.exportUdhar);

export default router;
