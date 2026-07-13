import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { AppError } from "../../middleware/error.js";
import * as ctrl from "./integrations.controller.js";
import * as svc from "./integrations.service.js";
import { createApiKeySchema, createWebhookSchema, updateWebhookSchema, integrationListQuerySchema, tallyExportQuerySchema } from "./integrations.schemas.js";

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
router.post("/api-keys", requireOwnerPin, validate(createApiKeySchema), ctrl.createKey);
router.delete("/api-keys/:id", requireOwnerPin, ctrl.revokeKey);
router.get("/webhooks", ctrl.endpoints);
router.post("/webhooks", requireOwnerPin, validate(createWebhookSchema), ctrl.createEndpoint);
router.patch("/webhooks/:id", requireOwnerPin, validate(updateWebhookSchema), ctrl.updateEndpoint);
router.delete("/webhooks/:id", requireOwnerPin, ctrl.deleteEndpoint);
router.post("/webhooks/:id/test", requireOwnerPin, ctrl.testEndpoint);
router.get("/deliveries", validateQuery(integrationListQuerySchema), ctrl.deliveries);
router.post("/deliveries/:id/retry", requireOwnerPin, ctrl.retryDelivery);
router.get("/exports/tally", validateQuery(tallyExportQuerySchema), ctrl.tally);

export default router;
