import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import * as ctrl from "./integrations.controller.js";
import * as svc from "./integrations.service.js";
import { createApiKeySchema, createWebhookSchema, updateWebhookSchema, integrationListQuerySchema, tallyExportQuerySchema, tallyPostedBodySchema } from "./integrations.schemas.js";

const router = Router();

async function requireIntegrationKey(req, _res, next) {
  try {
    const raw = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
    req.integration = await svc.authenticateApiKey(raw);
    next();
  } catch (error) { next(error); }
}

router.get("/v1/:resource", requireIntegrationKey, validateQuery(integrationListQuerySchema), ctrl.apiResource);

router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"));
router.get("/overview", ctrl.overview);
router.get("/api-keys", ctrl.keys);
router.post("/api-keys", requireFeature("api_webhook_later"), requireOwnerPin, validate(createApiKeySchema), ctrl.createKey);
router.delete("/api-keys/:id", requireOwnerPin, ctrl.revokeKey);
router.get("/webhooks", ctrl.endpoints);
router.post("/webhooks", requireFeature("api_webhook_later"), requireOwnerPin, validate(createWebhookSchema), ctrl.createEndpoint);
router.patch("/webhooks/:id", requireFeature("api_webhook_later"), requireOwnerPin, validate(updateWebhookSchema), ctrl.updateEndpoint);
router.delete("/webhooks/:id", requireOwnerPin, ctrl.deleteEndpoint);
router.post("/webhooks/:id/test", requireFeature("api_webhook_later"), requireOwnerPin, ctrl.testEndpoint);
router.get("/deliveries", validateQuery(integrationListQuerySchema), ctrl.deliveries);
router.post("/deliveries/:id/retry", requireFeature("api_webhook_later"), requireOwnerPin, ctrl.retryDelivery);
router.get("/exports/tally", requireFeature("tally_export"), validateQuery(tallyExportQuerySchema), ctrl.tally);
router.get("/exports/tally/envelope", requireFeature("tally_export"), validateQuery(tallyExportQuerySchema), ctrl.tallyEnvelope);
// Confirmation that a live TallyPrime accepted an envelope. Not owner-PIN gated:
// it records what already happened, and a prompt the shopkeeper cannot answer
// here would leave Tally holding vouchers this app thinks it never sent.
router.post("/exports/tally/posted", requireFeature("tally_export"), validate(tallyPostedBodySchema), ctrl.tallyPosted);

export default router;
