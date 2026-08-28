import { Router } from "express";
import * as ctrl from "./public.controller.js";
import { storefrontWriteLimiter } from "../../middleware/security.js";

// Public, unauthenticated routes for the QR customer self-order flow. No requireAuth /
// requireShop / requireDeviceActivated here on purpose — these are read-only, storefront-safe,
// owner-opted-in endpoints. They still ride the global /api rate limiter mounted in app.js.
const router = Router();

router.get("/shops/:shopId/catalog", ctrl.catalog);
// A self-order screen waking up asks whether it is still a live terminal. No
// session exists behind a kiosk, so this sits with the other storefront reads;
// a retired or unknown code is a flat 404 and reveals nothing else.
router.get("/shops/:shopId/kiosk/:terminalCode", ctrl.kioskTerminal);
// Customer submits an order from their phone; it lands in the owner's Orders Received inbox.
router.post("/shops/:shopId/orders", storefrontWriteLimiter, ctrl.submitOrder);
// Customer tracks their own order by its unguessable id (received → preparing → ready / declined).
router.get("/shops/:shopId/orders/:orderId", ctrl.orderStatus);
router.post("/shops/:shopId/orders/:orderId/cancel", storefrontWriteLimiter, ctrl.cancelOrder);
router.post("/shops/:shopId/orders/:orderId/feedback", storefrontWriteLimiter, ctrl.submitFeedback);
router.post("/shops/:shopId/tables/:tableId/requests", storefrontWriteLimiter, ctrl.createGuestRequest);
// What a table currently owes, across every round it has ordered. A dine-in
// table orders more than once and settles once, so a guest asking for the bill
// must be shown the whole sitting — reading one round back would put a smaller
// number in front of them than the counter is about to charge.
router.get("/shops/:shopId/tables/:tableId/bill", ctrl.tableBill);
// Online-session activity (§13). Only ONLINE_* event types are accepted and no
// user is ever attributed — see online-activity.service.js for the full box.
router.post("/shops/:shopId/activity", ctrl.onlineActivity);

export default router;
