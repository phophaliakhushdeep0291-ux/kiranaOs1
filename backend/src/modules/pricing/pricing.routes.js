import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { validate } from "../../middleware/validate.js";
import { evaluateSchema, createRuleSchema, updateRuleSchema, pricingSettingsSchema } from "./pricing.schema.js";
import * as ctrl from "./pricing.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// Read + evaluate — any authenticated shop user (cashiers price bills).
router.post("/evaluate", validate(evaluateSchema), ctrl.evaluate);
router.get("/rules", ctrl.listRules);
router.get("/settings", ctrl.getSettings);
router.get("/products/:productId", ctrl.productPricing);

// Mutations — owner/admin only (managing permanent prices + smart-pricing config).
router.post("/rules", requireRole("owner", "admin"), validate(createRuleSchema), ctrl.createRule);
router.patch("/rules/:id", requireRole("owner", "admin"), validate(updateRuleSchema), ctrl.updateRule);
router.delete("/rules/:id", requireRole("owner", "admin"), ctrl.deleteRule);
router.patch("/settings", requireRole("owner", "admin"), validate(pricingSettingsSchema), ctrl.updateSettings);

export default router;
