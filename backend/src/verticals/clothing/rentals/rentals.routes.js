import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { validate } from "../../../middleware/validate.js";
import { cancelRentalSchema, createRentalSchema, returnRentalSchema, updateRentalSchema } from "./rentals.schema.js";
import * as ctrl from "./rentals.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

// Static paths first — "/availability" must not be swallowed by "/:id".
router.get("/availability", ctrl.availability);
router.get("/summary", ctrl.summary);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createRentalSchema), ctrl.create);
router.patch("/:id", validate(updateRentalSchema), ctrl.update);
router.post("/:id/pickup", ctrl.pickup);
router.post("/:id/return", validate(returnRentalSchema), ctrl.markReturned);
router.post("/:id/cancel", validate(cancelRentalSchema), ctrl.cancel);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
