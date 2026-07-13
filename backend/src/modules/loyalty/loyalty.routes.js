import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { redeemSchema, updateProgramSchema } from "./loyalty.schema.js";
import * as controller from "./loyalty.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireFeature("loyalty_program"));
router.get("/program", controller.program);
router.put("/program", requireRole("owner", "admin"), requireOwnerPin, validate(updateProgramSchema), controller.updateProgram);
router.get("/accounts", controller.accounts);
router.get("/accounts/:customerId", controller.account);
router.post("/accounts/:customerId/redeem", requireRole("owner", "admin"), requireOwnerPin, validate(redeemSchema), controller.redeem);

export default router;
