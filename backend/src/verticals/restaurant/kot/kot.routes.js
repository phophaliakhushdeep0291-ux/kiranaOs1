import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import { fireTicketSchema, updateTicketStatusSchema } from "./kot.schema.js";
import * as ctrl from "./kot.controller.js";

const router = Router();
// Gated on the capability rather than the trade, matching tables: any shop that
// sends orders to a kitchen holds KOT, and one that does not is turned away by
// the server rather than only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("KOT"));

router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(fireTicketSchema), ctrl.fire);
router.patch("/:id/status", validate(updateTicketStatusSchema), ctrl.updateStatus);
router.delete("/:id", ctrl.remove);

export default router;
