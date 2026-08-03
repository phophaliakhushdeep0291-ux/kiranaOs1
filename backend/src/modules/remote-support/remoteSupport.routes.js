import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate } from "../../middleware/validate.js";
import { autoFixSettingsSchema, commandResultSchema, createSessionSchema } from "./remoteSupport.schema.js";
import * as ctrl from "./remoteSupport.controller.js";

const router = Router();

// Like the diagnostics routes, this deliberately does NOT require device
// activation: a device whose activation is broken is precisely the one that needs
// to hand support a code and drain a repair command.
router.use(requireAuth, requireShop);

// Granting outsiders a window into the shop's data is an owner's decision alone —
// not a manager's, and not a staff member's.
router.post("/sessions", requireRole("owner"), validate(createSessionSchema), ctrl.createSession);
router.get("/state", requireRole("owner"), ctrl.getState);
router.delete("/sessions/:sessionId", requireRole("owner"), ctrl.revokeSession);
router.delete("/sessions", requireRole("owner"), ctrl.revokeSession);

// Unattended fixes run with no operator watching, so the owner keeps the switch.
router.patch("/auto-fix", requireRole("owner"), validate(autoFixSettingsSchema), ctrl.updateAutoFix);

// Device queue. Any authenticated user of the shop, because the till is often
// signed in as staff — the command was still authorised by the owner's code, and
// the device may only ever see its own row.
router.get("/commands", ctrl.pollCommands);
router.post("/commands/:commandId/ack", validate(commandResultSchema), ctrl.ackCommand);

export default router;
