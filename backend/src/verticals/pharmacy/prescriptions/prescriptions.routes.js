import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import {
  cancelPrescriptionSchema,
  createPrescriptionSchema,
  dispensePrescriptionSchema,
  updatePrescriptionSchema,
} from "./prescriptions.schema.js";
import * as ctrl from "./prescriptions.controller.js";

const router = Router();
// Gated on the capability rather than the business type: the register belongs to
// anyone who dispenses against prescriptions, and a shop that does not is turned
// away by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("PRESCRIPTION_TRACKING"));

// Static paths first — "/summary" must not be swallowed by "/:id".
router.get("/summary", ctrl.summary);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createPrescriptionSchema), ctrl.create);
router.patch("/:id", validate(updatePrescriptionSchema), ctrl.update);
router.post("/:id/dispense", validate(dispensePrescriptionSchema), ctrl.dispense);
router.post("/:id/cancel", validate(cancelPrescriptionSchema), ctrl.cancel);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
