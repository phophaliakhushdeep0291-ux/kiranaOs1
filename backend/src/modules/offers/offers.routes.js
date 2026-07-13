import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { validate } from "../../middleware/validate.js";
import { applyOfferSchema, createOfferSchema, updateOfferSchema } from "./offers.schema.js";
import * as ctrl from "./offers.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.post("/apply", requireFeature("dynamic_customer_pricing"), validate(applyOfferSchema), ctrl.apply);
router.post("/", requireFeature("dynamic_customer_pricing"), validate(createOfferSchema), ctrl.create);
router.patch("/:id", requireFeature("dynamic_customer_pricing"), validate(updateOfferSchema), ctrl.update);
router.delete("/:id", requireFeature("dynamic_customer_pricing"), ctrl.remove);
router.post("/:id/restore", requireFeature("dynamic_customer_pricing"), ctrl.restore);
router.post("/:id/redeem", requireFeature("dynamic_customer_pricing"), ctrl.redeem);

export default router;
