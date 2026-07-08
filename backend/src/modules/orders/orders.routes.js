import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import * as ctrl from "./orders.controller.js";

// Owner-facing "Orders Received" inbox for customer QR self-orders. Shop-scoped and auth-gated
// (the submit side is the only public route). Any shop member can view/triage incoming orders.
const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.patch("/:id", ctrl.updateStatus);

export default router;
