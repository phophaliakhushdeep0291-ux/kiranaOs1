import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requirePlatformAdmin } from "../../middleware/platformAdmin.js";
import * as ctrl from "./platformAdmin.controller.js";

const router = Router();

// requireAuth (but NOT requireShop): platform admin is a person, not a tenant.
router.use(requireAuth);

// Cheap "am I an admin?" probe for the frontend nav — reveals nothing cross-tenant.
router.get("/access", ctrl.access);

// The cross-shop rollup is strictly gated behind the email allowlist.
router.get("/overview", requirePlatformAdmin, ctrl.overview);

export default router;
