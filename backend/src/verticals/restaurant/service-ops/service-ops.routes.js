import { Router } from "express";
import { requireAuth, requireRole } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireFeature } from "../../../modules/feature-gates/featureGate.middleware.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate, validateQuery } from "../../../middleware/validate.js";
import {
  createKioskSchema,
  createReservationSchema,
  createShiftSchema,
  reservationListQuery,
  reservationStatusSchema,
  shiftListQuery,
  updateKioskSchema,
  updateReservationSchema,
  updateShiftSchema,
  guestRequestListQuery,
  guestRequestStatusSchema,
} from "./service-ops.schema.js";
import * as ctrl from "./service-ops.controller.js";

const router = Router();
// Gated on the same capability as the floor plan: a shop that seats guests at
// numbered tables is exactly the shop that books them ahead and rosters staff
// against the sitting. Turned away by the server, not only by a hidden sidebar.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("restaurant_tables"), requireCapability("TABLE_MANAGEMENT"));

// ── Reservations ────────────────────────────────────────────────────
router.get("/reservations", validateQuery(reservationListQuery), ctrl.listReservations);
router.post("/reservations", validate(createReservationSchema), ctrl.createReservation);
router.patch("/reservations/:id", validate(updateReservationSchema), ctrl.updateReservation);
router.post("/reservations/:id/status", validate(reservationStatusSchema), ctrl.setReservationStatus);

// ── Staff scheduling ────────────────────────────────────────────────
// Static path before "/:id" so it is not swallowed by a detail route later.
router.get("/shifts/roster", validateQuery(shiftListQuery), ctrl.roster);
router.get("/shifts", validateQuery(shiftListQuery), ctrl.listShifts);
// Who works when is a management decision, not a floor one.
router.post("/shifts", requireRole("owner", "admin"), validate(createShiftSchema), ctrl.createShift);
router.patch("/shifts/:id", requireRole("owner", "admin"), validate(updateShiftSchema), ctrl.updateShift);

// ── Kiosk terminals ─────────────────────────────────────────────────
// Registering a terminal opens an unauthenticated ordering surface in the room,
// so only an owner or admin may create or retire one.
router.get("/kiosks", ctrl.listTerminals);
router.post("/kiosks", requireRole("owner", "admin"), validate(createKioskSchema), ctrl.createTerminal);
router.patch("/kiosks/:id", requireRole("owner", "admin"), validate(updateKioskSchema), ctrl.updateTerminal);

router.get("/guest-requests", validateQuery(guestRequestListQuery), ctrl.listGuestRequests);
router.post("/guest-requests/:id/status", validate(guestRequestStatusSchema), ctrl.setGuestRequestStatus);

export default router;
