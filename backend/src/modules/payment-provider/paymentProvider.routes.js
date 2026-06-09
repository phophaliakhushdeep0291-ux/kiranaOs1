import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate } from "../../middleware/validate.js";
import { manualPaymentSchema } from "./paymentProvider.schemas.js";
import * as ctrl from "./paymentProvider.controller.js";

const router = Router();

router.post("/razorpay/webhook", ctrl.razorpayWebhook);
router.get("/events", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), ctrl.listEvents);
router.post("/events/:id/retry", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.retryEvent);
router.post("/manual/activate", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, validate(manualPaymentSchema), ctrl.manualActivate);

export default router;
