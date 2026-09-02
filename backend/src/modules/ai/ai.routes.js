import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { parseCommandSchema, logActionSchema, agentChatSchema, agentPlanSchema, aiFeedbackSchema } from "./ai.schema.js";
import { requireOwnerPin } from "../../middleware/permissions.js";
import * as agent from "./agent/agent.controller.js";
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
router.post("/feedback", validate(aiFeedbackSchema), ctrl.feedback);
router.get("/feedback/summary", requireRole("owner", "admin"), ctrl.feedbackSummary);

/**
 * The agent: reads freely, proposes changes, executes only what was confirmed.
 *
 * Two confirm routes rather than one. A plan that only adds a customer should
 * not demand the owner's PIN, and a plan that changes a price must. The plain
 * route refuses the latter with OWNER_PIN_REQUIRED and the client retries on
 * /confirm-owner, where requireOwnerPin — the same gate every other sensitive
 * route uses — has to pass first.
 */
router.get("/agent/capabilities", agent.capabilities);
router.post("/agent/chat", validate(agentChatSchema), agent.chat);
router.post("/agent/confirm", validate(agentPlanSchema), agent.confirm);
router.post("/agent/confirm-owner", validate(agentPlanSchema), requireOwnerPin, agent.confirm);
router.post("/agent/reject", validate(agentPlanSchema), agent.reject);

export default router;
