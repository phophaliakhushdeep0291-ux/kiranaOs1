import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { errorReportSchema, supportRequestSchema } from "./diagnostics.schema.js";
import * as ctrl from "./diagnostics.controller.js";

const router = Router();

// Every diagnostics endpoint needs an authenticated tenant context. We deliberately
// do NOT require device activation here: error and issue reporting must keep working
// even when the device/license state is precisely what the user is trying to report.
router.use(requireAuth, requireShop);

// Ingest — any authenticated user of the shop.
router.post("/errors", validate(errorReportSchema), ctrl.reportError);
router.post("/support-requests", validate(supportRequestSchema), ctrl.createSupportRequest);

// Read surfaces — owner only. These feed the internal admin dashboard (Phase 4).
router.get("/errors", requireRole("owner"), ctrl.listErrors);
router.get("/errors/:id", requireRole("owner"), ctrl.getErrorGroup);
router.get("/support-requests", requireRole("owner"), ctrl.listSupport);

export default router;
