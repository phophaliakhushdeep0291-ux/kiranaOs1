import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requirePlatformAdmin } from "../../middleware/platformAdmin.js";
import { validate } from "../../middleware/validate.js";
import { dispatchCommandSchema, redeemCodeSchema } from "../remote-support/remoteSupport.schema.js";
import * as remoteSupport from "../remote-support/remoteSupport.controller.js";
import * as ctrl from "./platformAdmin.controller.js";

const router = Router();

// requireAuth (but NOT requireShop): platform admin is a person, not a tenant.
router.use(requireAuth);

// Cheap "am I an admin?" probe for the frontend nav — reveals nothing cross-tenant.
router.get("/access", ctrl.access);

// The cross-shop rollup is strictly gated behind the email allowlist.
router.get("/overview", requirePlatformAdmin, ctrl.overview);

// Remote support. Being a platform admin is necessary but NOT sufficient here:
// every route below also needs a live session the shop owner consented to, which
// requireOperatorSession re-checks per request. The rollup above is the most an
// operator can see without one.
router.get("/support/catalog", requirePlatformAdmin, remoteSupport.catalog);
router.post("/support/redeem", requirePlatformAdmin, validate(redeemCodeSchema), remoteSupport.redeem);
router.get("/support/sessions/:sessionId/diagnostics", requirePlatformAdmin, remoteSupport.shopDiagnostics);
router.post("/support/commands", requirePlatformAdmin, validate(dispatchCommandSchema), remoteSupport.dispatch);
router.delete("/support/sessions/:sessionId", requirePlatformAdmin, remoteSupport.endSession);

export default router;
