import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { cancelPurchaseOrderSchema, createPurchaseOrderSchema, listPurchaseOrdersSchema, receivePurchaseOrderSchema } from "./purchaseOrders.schema.js";
import * as controller from "./purchaseOrders.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("purchase_entry"));
router.get("/suggestions", controller.suggestions);
router.get("/", validateQuery(listPurchaseOrdersSchema), controller.list);
router.get("/:id", controller.get);
router.post("/", requireRole("owner", "admin"), validate(createPurchaseOrderSchema), controller.create);
router.post("/:id/send", requireRole("owner", "admin"), requireOwnerPin, controller.send);
router.post("/:id/receive", requireRole("owner", "admin"), requireOwnerPin, validate(receivePurchaseOrderSchema), controller.receive);
router.post("/:id/cancel", requireRole("owner", "admin"), requireOwnerPin, validate(cancelPurchaseOrderSchema), controller.cancel);

export default router;
