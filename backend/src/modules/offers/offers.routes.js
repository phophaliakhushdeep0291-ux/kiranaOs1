import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { applyOfferSchema, createOfferSchema, updateOfferSchema } from "./offers.schema.js";
import * as ctrl from "./offers.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.post("/apply", validate(applyOfferSchema), ctrl.apply);
router.post("/", validate(createOfferSchema), ctrl.create);
router.patch("/:id", validate(updateOfferSchema), ctrl.update);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
