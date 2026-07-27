import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { complianceExportQuery, eWayBillSchema, hsnCategoryAssignmentSchema } from "./compliance.schema.js";
import * as controller from "./compliance.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());
router.get("/readiness", requireRole("owner", "admin"), controller.readiness);
router.get("/gst-register", requireRole("owner", "admin"), requireLocationAccess("view"), requireFeature("gst_reports"), validateQuery(complianceExportQuery), controller.gstRegister);
router.get("/gstr1-working", requireRole("owner", "admin"), requireLocationAccess("view"), requireFeature("gst_reports"), validateQuery(complianceExportQuery), controller.gstr1Working);
router.get("/gstr3b-working", requireRole("owner", "admin"), requireLocationAccess("view"), requireFeature("gst_reports"), validateQuery(complianceExportQuery), controller.gstr3bWorking);
router.get("/hsn-summary", requireRole("owner", "admin"), requireFeature("gst_reports"), controller.hsnSummary);
router.put("/hsn-category", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, validate(hsnCategoryAssignmentSchema), controller.assignHsnCategory);
router.post("/e-invoices/:billId/sandbox", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, controller.sandboxEInvoice);
router.post("/e-invoices/:billId/submit", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, controller.submitEInvoice);
router.post("/e-way-bills/:billId/draft", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, validate(eWayBillSchema), controller.draftEWayBill);
router.post("/e-way-bills/:billId/submit", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, validate(eWayBillSchema), controller.submitEWayBill);

export default router;
