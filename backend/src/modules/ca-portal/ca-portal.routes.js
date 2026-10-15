import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import * as ctrl from "./ca-portal.controller.js";
import { caPeriodQuerySchema, caLinkClientSchema, caGenerateCodeSchema, caTallyExportQuerySchema } from "./ca-portal.schema.js";
const router = Router();
// Accountants use their own owner account. Client grants authorize only the
// read endpoints below; they never create a staff login in the client's shop.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner"));
router.get("/overview", validateQuery(caPeriodQuerySchema), ctrl.overview);
router.get("/clients/:shopId", validateQuery(caPeriodQuerySchema), ctrl.clientDetails);
router.get("/clients/:shopId/tally", validateQuery(caTallyExportQuerySchema), ctrl.tallyExport);
router.post("/link", validate(caLinkClientSchema), ctrl.linkClient);
router.post("/generate-code", requireOwnerPin, validate(caGenerateCodeSchema), ctrl.generateCode);
router.get("/access", ctrl.listAccess);
router.delete("/access/:id", requireOwnerPin, ctrl.revokeAccess);
export default router;
