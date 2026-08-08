import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireFeature } from "../../../modules/feature-gates/featureGate.middleware.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import {
  bulkFitmentSchema,
  createCrossReferenceSchema,
  createFitmentSchema,
  updateCrossReferenceSchema,
  updateFitmentSchema,
} from "./fitment.schema.js";
import * as ctrl from "./fitment.controller.js";

const router = Router();
// Gated on the capability rather than the business type: a hardware shop runs
// the same pack without fitment, and a shop that does not answer "does this
// fit?" is turned away by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("vehicle_fitment"), requireCapability("VEHICLE_FITMENT"));

// Static paths first — none of these may be swallowed by "/:id".
router.get("/search", ctrl.findForVehicle);
router.get("/vehicles", ctrl.vehicleOptions);
router.get("/summary", ctrl.summary);
router.get("/part-number/:partNumber", ctrl.byPartNumber);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);

router.post("/", validate(createFitmentSchema), ctrl.create);
router.post("/bulk", validate(bulkFitmentSchema), ctrl.createBulk);

// Cross-references live under the same capability: "what else will do?" is the
// other half of the same counter conversation. Registered before the "/:id"
// routes so the prefix can never be read as a fitment id.
router.post("/references", validate(createCrossReferenceSchema), ctrl.createReference);
router.patch("/references/:id", validate(updateCrossReferenceSchema), ctrl.updateReference);
router.delete("/references/:id", ctrl.removeReference);

router.patch("/:id", validate(updateFitmentSchema), ctrl.update);
router.delete("/:id", ctrl.remove);

export default router;
