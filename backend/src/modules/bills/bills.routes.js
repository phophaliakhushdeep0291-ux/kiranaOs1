import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { confirmBillSchema, cancelBillSchema, billQuerySchema, saleReturnSchema } from "./bills.schema.js";
import * as ctrl from "./bills.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

function requireSensitiveBillApproval(req, res, next) {
  const actions = Array.isArray(req.body?.sensitiveActions) ? [...req.body.sensitiveActions] : [];
  if (Number(req.body?.loyaltyPointsToRedeem || 0) > 0) actions.push("loyalty_redemption");
  if (!actions.some((action) => ["large_discount", "selling_below_minimum_price", "loyalty_redemption"].includes(action))) return next();
  return requireOwnerPin(req, res, next);
}

router.get("/", requireLocationAccess("view"), validateQuery(billQuerySchema), ctrl.list);
router.get("/:id", ctrl.get);
router.post("/confirm", requireLocationAccess("sell"), requireFeature("basic_billing"), validate(confirmBillSchema), requireSensitiveBillApproval, ctrl.confirm);
router.post("/returns", requireLocationAccess("sell"), requireFeature("basic_billing"), requireOwnerPin, validate(saleReturnSchema), ctrl.saleReturn);
router.post("/:id/cancel", requireOwnerPin, validate(cancelBillSchema), ctrl.cancel);
router.post("/:id/delete", requireOwnerPin, validate(cancelBillSchema), ctrl.remove);
router.post("/:id/restore", requireOwnerPin, validate(cancelBillSchema), ctrl.restore);

export default router;
