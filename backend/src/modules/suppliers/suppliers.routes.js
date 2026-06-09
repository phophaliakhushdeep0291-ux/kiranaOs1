import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate } from "../../middleware/validate.js";
import { createSupplierSchema, updateSupplierSchema } from "./suppliers.schema.js";
import * as ctrl from "./suppliers.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.get("/best-price/:productId", ctrl.bestPrice);
router.post("/", requireFeature("supplier_entry"), validate(createSupplierSchema), ctrl.create);
router.patch("/:id", requireFeature("supplier_entry"), validate(updateSupplierSchema), ctrl.update);
router.delete("/:id", requireFeature("supplier_entry"), requireOwnerPin, ctrl.remove);
router.post("/:id/restore", requireFeature("supplier_entry"), requireOwnerPin, ctrl.restore);

export default router;
