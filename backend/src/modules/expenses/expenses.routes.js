import { Router } from "express";
import { requireAuth } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { createExpenseSchema, updateExpenseSchema } from "./expenses.schema.js";
import * as ctrl from "./expenses.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated());

router.get("/", ctrl.list);
router.get("/summary", ctrl.summary);
router.get("/overview", ctrl.overview);
router.post("/", validate(createExpenseSchema), ctrl.create);
// An edit replaces the accounting effect with reversing + replacement ledger
// entries. Protect it exactly like delete/restore so a staff session cannot
// rewrite historical cash without explicit owner approval.
router.patch("/:id", requireOwnerPin, validate(updateExpenseSchema), ctrl.update);
router.delete("/:id", requireOwnerPin, ctrl.remove);
router.post("/:id/restore", requireOwnerPin, ctrl.restore);

export default router;
