import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireOwnerPinForPurchasePriceChange, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { purchaseSchema, damageSchema, correctionSchema, ledgerQuerySchema } from "./inventory.schema.js";
import * as ctrl from "./inventory.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", requireLocationAccess("view"), ctrl.getInventory);
router.get("/low-stock", requireLocationAccess("view"), ctrl.getLowStock);
router.get("/ledger", requireLocationAccess("view"), validateQuery(ledgerQuerySchema), ctrl.getLedger);
router.post("/purchase", requireLocationAccess("purchase"), requireFeature("purchase_entry"), requireOwnerPinForPurchasePriceChange, validate(purchaseSchema), ctrl.purchase);
router.post("/damage", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(damageSchema), ctrl.damage);
router.post("/correction", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(correctionSchema), ctrl.correction);

export default router;
