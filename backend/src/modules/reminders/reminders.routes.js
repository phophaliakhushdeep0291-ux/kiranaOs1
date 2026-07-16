import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { featureNotAvailableError } from "./reminders.controller.js";
import {
  createTemplateSchema,
  listLogsQuerySchema,
  sendReminderSchema,
  sendStatementSchema,
  updateTemplateSchema,
} from "./reminders.schemas.js";
import * as ctrl from "./reminders.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// WhatsApp reminders are a Pro feature. Wrap requireFeature("whatsapp_reminders")
// so clients get the product-facing FEATURE_NOT_AVAILABLE code requested by policy.
function requireWhatsAppReminders(req, res, next) {
  return requireFeature("whatsapp_reminders")(req, res, (err) => {
    if (!err) return next();
    if (["FEATURE_NOT_INCLUDED", "PLAN_TOO_LOW"].includes(err.code)) return next(featureNotAvailableError());
    return next(err);
  });
}

router.use(requireWhatsAppReminders);

router.get("/status", ctrl.status);
router.get("/templates", ctrl.templates);
router.post("/templates", requireRole("owner", "admin"), validate(createTemplateSchema), ctrl.createTemplate);
router.patch("/templates/:id", requireRole("owner", "admin"), validate(updateTemplateSchema), ctrl.updateTemplate);
router.delete("/templates/:id", requireRole("owner", "admin"), ctrl.deleteTemplate);
router.get("/logs", validateQuery(listLogsQuerySchema), ctrl.logs);
router.post("/send", validate(sendReminderSchema), ctrl.send);
router.post("/send-statement", validate(sendStatementSchema), ctrl.sendStatement);

export default router;
