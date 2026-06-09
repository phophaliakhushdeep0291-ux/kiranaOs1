import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate } from "../../middleware/validate.js";
import { createCustomerSchema, updateCustomerSchema, udharPaymentSchema, reverseUdharPaymentSchema } from "./customers.schema.js";
import * as ctrl from "./customers.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.get("/:id", ctrl.get);
router.get("/:id/khata", ctrl.getKhata);
router.post("/", requireFeature("customer_ledger"), validate(createCustomerSchema), ctrl.create);
router.patch("/:id", validate(updateCustomerSchema), ctrl.update);
// Owner PIN required: deleting a customer with outstanding udhar hides financial history.
router.delete("/:id", requireOwnerPin, ctrl.remove);
router.post("/:id/udhar-payment/:ledgerId/reverse", requireOwnerPin, validate(reverseUdharPaymentSchema), ctrl.reverseUdharPayment);
router.post("/:id/udhar-payment", requireFeature("record_payment"), validate(udharPaymentSchema), ctrl.udharPayment);

export default router;
