import { Router } from "express";
import { requireAuth } from "../../../middleware/auth.js";
import { requireDeviceActivated } from "../../../modules/devices/device.middleware.js";
import { requireShop } from "../../../middleware/permissions.js";
import { requireCapability } from "../../../modules/shops/businessProfile.middleware.js";
import { validate } from "../../../middleware/validate.js";
import {
  receiveUnitsSchema,
  returnUnitSchema,
  sellUnitSchema,
  serviceUnitSchema,
  updateUnitSchema,
  writeOffUnitSchema,
} from "./units.schema.js";
import * as ctrl from "./units.controller.js";

const router = Router();
// Gated on the capability rather than the business type: naming each piece of
// stock belongs to anyone selling serialised goods, and a shop that does not is
// turned away by the server, not only by a hidden sidebar entry.
router.use(requireAuth, requireShop, requireDeviceActivated(), requireCapability("SERIAL_TRACKING"));

// Static paths first — "/summary" and "/lookup" must not be swallowed by "/:id".
router.get("/summary", ctrl.summary);
router.get("/lookup/:code", ctrl.lookup);
router.get("/for-product/:productId", ctrl.forProduct);
router.get("/", ctrl.list);
router.get("/:id", ctrl.detail);

router.post("/", validate(receiveUnitsSchema), ctrl.receive);
router.patch("/:id", validate(updateUnitSchema), ctrl.update);
router.post("/:id/sell", validate(sellUnitSchema), ctrl.sell);
router.post("/:id/return", validate(returnUnitSchema), ctrl.takeBack);
router.post("/:id/service", validate(serviceUnitSchema), ctrl.toService);
router.post("/:id/service-return", validate(returnUnitSchema), ctrl.fromService);
router.post("/:id/write-off", validate(writeOffUnitSchema), ctrl.writeOff);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
