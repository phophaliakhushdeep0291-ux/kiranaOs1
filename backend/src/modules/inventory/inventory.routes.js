import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireOwnerPinForPurchasePriceChange, requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { purchaseSchema, damageSchema, correctionSchema, ledgerQuerySchema } from "./inventory.schema.js";
import * as ctrl from "./inventory.controller.js";
import { requireLocationAccess } from "../stores/location-access.service.js";
import { createStockCountSchema, stockCountDecisionSchema, stockCountListSchema, updateStockCountLinesSchema } from "./stockCounts.schema.js";
import * as stockCounts from "./stockCounts.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", requireLocationAccess("view"), ctrl.getInventory);
router.get("/low-stock", requireLocationAccess("view"), ctrl.getLowStock);
router.get("/ledger", requireLocationAccess("view"), validateQuery(ledgerQuerySchema), ctrl.getLedger);
router.get("/counts", requireLocationAccess("view"), validateQuery(stockCountListSchema), stockCounts.list);
router.post("/counts", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), validate(createStockCountSchema), stockCounts.create);
router.get("/counts/:id", requireLocationAccess("view"), stockCounts.get);
router.patch("/counts/:id/lines", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), validate(updateStockCountLinesSchema), stockCounts.updateLines);
router.post("/counts/:id/submit", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), stockCounts.submit);
router.post("/counts/:id/apply", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(stockCountDecisionSchema), stockCounts.apply);
router.post("/counts/:id/cancel", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(stockCountDecisionSchema), stockCounts.cancel);
router.post("/purchase", requireLocationAccess("purchase"), requireFeature("purchase_entry"), requireOwnerPinForPurchasePriceChange, validate(purchaseSchema), ctrl.purchase);
router.post("/damage", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(damageSchema), ctrl.damage);
router.post("/correction", requireLocationAccess("inventory"), requireFeature("stock_adjustment"), requireOwnerPin, validate(correctionSchema), ctrl.correction);

export default router;
