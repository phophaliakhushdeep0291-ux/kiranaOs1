import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { cancelPurchaseOrderSchema, createPurchaseOrderSchema, listPurchaseOrdersSchema, receivePurchaseOrderSchema, reconcilePurchaseReceiptSchema } from "./purchaseOrders.schema.js";
import * as controller from "./purchaseOrders.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("purchase_entry"));
router.get("/suggestions", requireLocationAccess("view"), controller.suggestions);
router.get("/", requireLocationAccess("view"), validateQuery(listPurchaseOrdersSchema), controller.list);
router.get("/:id", controller.get);
router.post("/", requireRole("owner", "admin"), requireLocationAccess("purchase"), validate(createPurchaseOrderSchema), controller.create);
router.post("/:id/send", requireRole("owner", "admin"), requireOwnerPin, controller.send);
router.post("/:id/receive", requireRole("owner", "admin"), requireOwnerPin, validate(receivePurchaseOrderSchema), controller.receive);
router.post("/:id/receipts/:receiptId/reconcile", requireRole("owner", "admin"), requireOwnerPin, validate(reconcilePurchaseReceiptSchema), controller.reconcileReceipt);
router.post("/:id/cancel", requireRole("owner", "admin"), requireOwnerPin, validate(cancelPurchaseOrderSchema), controller.cancel);

export default router;
