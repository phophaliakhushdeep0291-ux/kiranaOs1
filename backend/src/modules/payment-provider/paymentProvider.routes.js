import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate } from "../../middleware/validate.js";
import { cardTerminalChargeSchema, manualPaymentSchema, paymentConnectionSchema, reconcileCardTerminalChargeSchema, retailIntentSchema, verifyRetailIntentSchema } from "./paymentProvider.schemas.js";
import * as ctrl from "./paymentProvider.controller.js";

const router = Router();

router.post("/razorpay/webhook", ctrl.razorpayWebhook);
router.post("/webhooks/razorpay/:connectionId", ctrl.restaurantRazorpayWebhook);
router.get("/connections", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), ctrl.listPaymentConnections);
router.put("/connections/:provider", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, validate(paymentConnectionSchema), ctrl.savePaymentConnection);
router.post("/connections/:provider/verify", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.verifyPaymentConnection);
router.post("/connections/:provider/select", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.selectPaymentConnection);
router.post("/connections/:provider/disable", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.disablePaymentConnection);
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
router.post("/terminal/charges/:id/reconcile", requireAuth, requireShop, requireDeviceActivated(), requireOwnerPin, validate(reconcileCardTerminalChargeSchema), ctrl.reconcileCardTerminalCharge);
router.get("/events", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), ctrl.listEvents);
router.post("/events/:id/retry", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, ctrl.retryEvent);
router.post("/manual/activate", requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"), requireOwnerPin, validate(manualPaymentSchema), ctrl.manualActivate);

export default router;
