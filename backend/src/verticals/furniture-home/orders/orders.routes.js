import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import {
  addPaymentSchema,
  cancelOrderSchema,
  createOrderSchema,
  setStatusSchema,
  updateOrderSchema,
} from "./orders.schema.js";
import * as ctrl from "./orders.controller.js";

const router = Router();
// Gated on the capability rather than the trade: any showroom that sells before
// the goods leave the floor holds SALES_ORDERS, and a shop that does not is
// turned away by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("SALES_ORDERS"));

// Static paths first — none of these may be swallowed by "/:id".
router.get("/summary", ctrl.summary);
router.get("/reservations", ctrl.reservations);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createOrderSchema), ctrl.create);
router.patch("/:id", validate(updateOrderSchema), ctrl.update);
router.post("/:id/status", validate(setStatusSchema), ctrl.setStatus);
router.post("/:id/cancel", validate(cancelOrderSchema), ctrl.cancel);
router.post("/:id/payments", validate(addPaymentSchema), ctrl.addPayment);
router.delete("/:id/payments/:paymentId", ctrl.removePayment);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
