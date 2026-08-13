import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireContinuityAction, requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { confirmBillSchema, cancelBillSchema, billQuerySchema, emailReceiptSchema, saleReturnSchema, whatsappBillSchema } from "./bills.schema.js";
import * as ctrl from "./bills.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";
import { assertSensitiveBillReason, deriveSensitiveBillActions } from "./bill-sensitive-approval.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

async function requireSensitiveBillApproval(req, res, next) {
  try {
    const actions = await deriveSensitiveBillActions(req.shopId, req.body);
    req.body.sensitiveActions = actions;
    req.sensitiveBillActions = actions;
    if (actions.length === 0) return next();
    assertSensitiveBillReason(actions, req.body.reason);
    return requireOwnerPin(req, res, next);
  } catch (error) {
    return next(error);
  }
}

router.get("/", requireLocationAccess("view"), validateQuery(billQuerySchema), ctrl.list);
router.get("/:id", ctrl.get);
router.post("/:id/email", requireFeature("basic_billing"), validate(emailReceiptSchema), ctrl.emailReceipt);
router.post("/:id/whatsapp", requireFeature("single_bill_whatsapp"), validate(whatsappBillSchema), ctrl.whatsappReceipt);
router.post("/confirm", requireLocationAccess("sell"), requireContinuityAction("complete_sale"), validate(confirmBillSchema), requireSensitiveBillApproval, ctrl.confirm);
router.post("/returns", requireLocationAccess("sell"), requireFeature("basic_billing"), requireOwnerPin, validate(saleReturnSchema), ctrl.saleReturn);
router.post("/:id/cancel", requireOwnerPin, validate(cancelBillSchema), ctrl.cancel);
router.post("/:id/delete", requireOwnerPin, validate(cancelBillSchema), ctrl.remove);
router.post("/:id/restore", requireOwnerPin, validate(cancelBillSchema), ctrl.restore);

export default router;
