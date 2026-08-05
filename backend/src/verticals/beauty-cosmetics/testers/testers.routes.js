import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { closeTesterSchema, openTesterSchema, updateTesterSchema } from "./testers.schema.js";
import * as ctrl from "./testers.controller.js";

const router = Router();
// Gated on the capability rather than the trade: any shop that puts stock out
// for customers to try holds TESTER_STOCK, and one that does not is turned away
// by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("TESTER_STOCK"));

// Static paths first — none of these may be swallowed by "/:id".
router.get("/summary", ctrl.summary);
router.get("/cost", ctrl.cost);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(openTesterSchema), ctrl.open);
router.patch("/:id", validate(updateTesterSchema), ctrl.update);
router.post("/:id/close", validate(closeTesterSchema), ctrl.close);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
