import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate } from "../../middleware/validate.js";
import { evaluateSchema, createRuleSchema, updateRuleSchema, pricingSettingsSchema, sellingUnitSchema, updateSellingUnitSchema } from "./pricing.schema.js";
import * as ctrl from "./pricing.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// Read + evaluate — any authenticated shop user (cashiers price bills).
router.post("/evaluate", validate(evaluateSchema), ctrl.evaluate);
router.get("/rules", ctrl.listRules);
router.get("/settings", ctrl.getSettings);
router.get("/products/:productId", ctrl.productPricing);
router.get("/products/:productId/units", ctrl.listSellingUnits);

// Mutations — owner/admin only (managing permanent prices + smart-pricing config).
router.post("/rules", requireRole("owner", "admin"), requireFeature("dynamic_customer_pricing"), validate(createRuleSchema), ctrl.createRule);
router.patch("/rules/:id", requireRole("owner", "admin"), requireFeature("dynamic_customer_pricing"), validate(updateRuleSchema), ctrl.updateRule);
router.delete("/rules/:id", requireRole("owner", "admin"), requireFeature("dynamic_customer_pricing"), ctrl.deleteRule);
router.post("/products/:productId/units", requireRole("owner", "admin"), validate(sellingUnitSchema), ctrl.createSellingUnit);
router.patch("/products/:productId/units/:unitId", requireRole("owner", "admin"), validate(updateSellingUnitSchema), ctrl.updateSellingUnit);
router.delete("/products/:productId/units/:unitId", requireRole("owner", "admin"), ctrl.deleteSellingUnit);
router.patch("/settings", requireRole("owner", "admin"), requireFeature("dynamic_customer_pricing"), validate(pricingSettingsSchema), ctrl.updateSettings);

export default router;
