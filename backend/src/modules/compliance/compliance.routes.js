import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { complianceExportQuery } from "./compliance.schema.js";
import * as controller from "./compliance.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());
router.get("/readiness", controller.readiness);
router.get("/gst-register", requireFeature("gst_reports"), validateQuery(complianceExportQuery), controller.gstRegister);
router.post("/e-invoices/:billId/sandbox", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, controller.sandboxEInvoice);
router.post("/e-invoices/:billId/submit", requireRole("owner", "admin"), requireFeature("gst_reports"), requireOwnerPin, controller.submitEInvoice);

export default router;
