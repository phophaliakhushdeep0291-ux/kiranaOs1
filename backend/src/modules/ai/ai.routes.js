import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { parseCommandSchema, logActionSchema } from "./ai.schema.js";
import { uploadAiAudio } from "./ai.upload.js";
import { uploadInvoiceImage } from "./invoice.upload.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { requireLocationAccess } from "../stores/location-access.service.js";
import * as ctrl from "./ai.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.post("/parse-command", validate(parseCommandSchema), ctrl.parseCommand);
router.post("/transcribe", uploadAiAudio, ctrl.transcribe);
router.post("/extract-purchase-invoice", requireFeature("purchase_entry"), requireLocationAccess("purchase"), uploadInvoiceImage, ctrl.extractPurchaseInvoice);
router.post("/log-action", validate(logActionSchema), ctrl.logAction);

export default router;
