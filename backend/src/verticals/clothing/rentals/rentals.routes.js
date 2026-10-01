import db from "../../../db.js";
import { requireLocationAccess, assertLocationCapability } from "../../../modules/stores/location-access.service.js";
import { resolveOperationalLocation } from "../../../modules/stores/location-context.service.js";
import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop, requireOwnerPin } from "../../../middleware/permissions.js";
import { requireFeature } from "../../../modules/feature-gates/featureGate.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { cancelRentalSchema, createRentalSchema, refundRentalSchema, returnRentalSchema, settleRentalSchema, updateRentalSchema } from "./rentals.schema.js";
import * as ctrl from "./rentals.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("clothing_rentals"), requireLocationAccess("sell"));
router.param("id", async (req, _res, next, id) => {
  try {
    const booking = await db.rentalBooking.findFirst({ where: { id, shopId: req.shopId }, select: { locationId: true } });
    if (booking) {
      const locationId = booking.locationId ?? (await resolveOperationalLocation(req.shopId)).id;
      await assertLocationCapability({ shopId: req.shopId, userId: req.user?.userId, role: req.user?.role, locationId, capability: "sell" });
    }
    next();
  } catch (error) { next(error); }
});

// Static paths first — "/availability" must not be swallowed by "/:id".
router.get("/availability", ctrl.availability);
router.get("/summary", ctrl.summary);
router.get("/payments", ctrl.payments);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(createRentalSchema), ctrl.create);
router.patch("/:id", validate(updateRentalSchema), ctrl.update);
router.post("/:id/pickup", ctrl.pickup);
router.post("/:id/return", validate(returnRentalSchema), ctrl.markReturned);
router.post("/:id/refund", requireOwnerPin, validate(refundRentalSchema), ctrl.refund);
router.post("/:id/settle", validate(settleRentalSchema), ctrl.settle);
router.post("/:id/cancel", validate(cancelRentalSchema), ctrl.cancel);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
