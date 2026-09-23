import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop, requireOwnerPin } from "../../../middleware/permissions.js";
import { requireFeature, requireContinuityAction } from "../../../modules/feature-gates/featureGate.middleware.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import db from "../../../db.js";
import { requireLocationAccess, assertLocationCapability } from "../../../modules/stores/location-access.service.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { validate } from "../../../middleware/validate.js";
import {
  addPaymentSchema,
  adjustPaymentSchema,
  linkCollectionSchema,
  cancelOrderSchema,
  createOrderSchema,
  createOrderInvoiceSchema,
  setStatusSchema,
  updateOrderSchema,
} from "./orders.schema.js";
import * as ctrl from "./orders.controller.js";

const router = Router();
// Gated on the capability rather than the trade: any showroom that sells before
// the goods leave the floor holds SALES_ORDERS, and a shop that does not is
// turned away by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("furniture_order_book"), requireCapability("SALES_ORDERS"), requireLocationAccess("sell"));
router.param("id", async (req, _res, next, id) => {
  try {
    const order = await db.furnitureOrder.findFirst({ where: { id, shopId: req.shopId }, select: { locationId: true } });
    if (order) {
      const locationId = order.locationId ?? (await resolveOperationalLocation(req.shopId)).id;
      await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId, capability: "sell" });
    }
    next();
  } catch (error) { next(error); }
});

// Static paths first — none of these may be swallowed by "/:id".
router.get("/summary", ctrl.summary);
router.get("/payments", ctrl.payments);
router.get("/reservations", ctrl.reservations);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);
router.get("/:id/collections", ctrl.collections);
router.get("/:id/invoice-preview", ctrl.invoicePreview);

router.post("/", validate(createOrderSchema), ctrl.create);
router.patch("/:id", validate(updateOrderSchema), ctrl.update);
router.post("/:id/status", validate(setStatusSchema), ctrl.setStatus);
router.post("/:id/invoice", requireContinuityAction("complete_sale"), requireOwnerPin, validate(createOrderInvoiceSchema), ctrl.createInvoice);
router.post("/:id/cancel", validate(cancelOrderSchema), ctrl.cancel);
router.post("/:id/payments", validate(addPaymentSchema), ctrl.addPayment);
router.post("/:id/payments/:paymentId/adjust", requireOwnerPin, validate(adjustPaymentSchema), ctrl.adjustPayment);
router.post("/:id/collections/:ledgerId/link", requireOwnerPin, validate(linkCollectionSchema), ctrl.linkCollection);
router.delete("/:id/payments/:paymentId", ctrl.removePayment);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
