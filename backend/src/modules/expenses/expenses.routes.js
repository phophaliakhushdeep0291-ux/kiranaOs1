import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createExpenseSchema, updateExpenseSchema } from "./expenses.schema.js";
import * as ctrl from "./expenses.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.get("/summary", ctrl.summary);
router.get("/overview", ctrl.overview);
router.post("/", validate(createExpenseSchema), ctrl.create);
router.patch("/:id", validate(updateExpenseSchema), ctrl.update);
router.delete("/:id", ctrl.remove);
router.post("/:id/restore", ctrl.restore);

export default router;
