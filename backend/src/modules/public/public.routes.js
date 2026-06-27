import { Router } from "express";
import * as ctrl from "./public.controller.js";

// Public, unauthenticated routes for the QR customer self-order flow. No requireAuth /
// requireShop / requireDeviceActivated here on purpose — these are read-only, storefront-safe,
// owner-opted-in endpoints. They still ride the global /api rate limiter mounted in app.js.
const router = Router();

router.get("/shops/:shopId/catalog", ctrl.catalog);

export default router;
