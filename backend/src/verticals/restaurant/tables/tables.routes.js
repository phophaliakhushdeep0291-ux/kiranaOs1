import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireFeature } from "../../../modules/feature-gates/featureGate.middleware.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { createTableSchema, replaceFloorPlanSchema, updateTableSchema } from "./tables.schema.js";
import * as ctrl from "./tables.controller.js";
// Importing this is what teaches the shared public catalogue that a restaurant
// serves a menu rather than a delivery storefront. It registers itself on load;
// mounting these routes in app.js is the only thing that reaches it.
import "../storefront/dine-in.storefront.js";

const router = Router();
// Gated on the capability rather than the trade: any shop that seats guests at
// numbered tables holds TABLE_MANAGEMENT, and one that does not is turned away
// by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("restaurant_tables"), requireCapability("TABLE_MANAGEMENT"));

router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createTableSchema), ctrl.create);
// Static path before "/:id" so it is not swallowed by the detail route.
router.put("/floor-plan", validate(replaceFloorPlanSchema), ctrl.replaceFloor);
router.patch("/:id", validate(updateTableSchema), ctrl.update);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
