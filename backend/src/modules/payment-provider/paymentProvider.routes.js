import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate } from "../../middleware/validate.js";
import { cardTerminalChargeSchema, manualPaymentSchema, retailIntentSchema, verifyRetailIntentSchema } from "./paymentProvider.schemas.js";
import * as ctrl from "./paymentProvider.controller.js";

const router = Router();

router.post("/razorpay/webhook", ctrl.razorpayWebhook);
router.get("/retail/readiness", requireAuth, requireShop, requireDeviceActivated(), ctrl.retailReadiness);
router.post("/retail/intents", requireAuth, requireShop, requireDeviceActivated(), validate(retailIntentSchema), ctrl.createRetailIntent);
router.get("/retail/intents/:id/status", requireAuth, requireShop, requireDeviceActivated(), ctrl.retailIntentStatus);
router.get("/retail/intents/:id/qr-bitmap", requireAuth, requireShop, requireDeviceActivated(), ctrl.retailIntentQrBitmap);
router.post("/retail/intents/:id/cancel", requireAuth, requireShop, requireDeviceActivated(), ctrl.cancelRetailIntent);
router.post("/retail/intents/:id/verify", requireAuth, requireShop, requireDeviceActivated(), validate(verifyRetailIntentSchema), ctrl.verifyRetailIntent);
router.get("/terminal/readiness", requireAuth, requireShop, requireDeviceActivated(), ctrl.cardTerminalReadiness);
router.post("/terminal/charges", requireAuth, requireShop, requireDeviceActivated(), validate(cardTerminalChargeSchema), ctrl.startCardTerminalCharge);
router.get("/terminal/charges/:id/status", requireAuth, requireShop, requireDeviceActivated(), ctrl.cardTerminalChargeStatus);
router.post("/terminal/charges/:id/cancel", requireAuth, requireShop, requireDeviceActivated(), ctrl.cancelCardTerminalCharge);
router.get("/events", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), ctrl.listEvents);
router.post("/events/:id/retry", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.retryEvent);
router.post("/manual/activate", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, validate(manualPaymentSchema), ctrl.manualActivate);

export default router;
