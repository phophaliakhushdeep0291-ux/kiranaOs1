import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import {
  pullQuerySchema,
  pushBodySchema,
  PUSH_MAX_BATCH_SIZE,
  PUSH_BATCH_TOO_LARGE_CODE,
  reportSyncConflictSchema,
  resolveSyncConflictSchema,
  syncAckSchema,
  syncConflictListQuerySchema,
} from "./sync.schema.js";
import * as ctrl from "./sync.controller.js";
import { requireDeviceActivated, requireDeviceAllowedForSync } from "../devices/device.middleware.js";

const router = Router();
router.use(requireAuth, requireShop);

/**
 * checkPushBatchSize — runs before Zod validation so the SYNC_BATCH_TOO_LARGE
 * error has a stable code field rather than a generic Zod validation message.
 *
 * Checks the raw body before the schema transform merges events/actions.
 * Both events[] and actions[] are checked; whichever is present is the effective array.
 */
function checkPushBatchSize(req, res, next) {
  const body = req.body ?? {};
  // Prefer events; fall back to actions (backward-compat alias); fall back to [].
  const effective = Array.isArray(body.events)
    ? body.events
    : Array.isArray(body.actions)
      ? body.actions
      : [];

  if (effective.length > PUSH_MAX_BATCH_SIZE) {
    return res.status(400).json({
      success: false,
      code: PUSH_BATCH_TOO_LARGE_CODE,
      error: `Sync batch too large. Please split into batches of ${PUSH_MAX_BATCH_SIZE} or fewer events.`,
      received: effective.length,
      maxAllowed: PUSH_MAX_BATCH_SIZE,
    });
  }
  next();
}

router.get("/status", requireDeviceActivated(), ctrl.status);
router.get("/diagnostics", requireDeviceActivated(), ctrl.diagnostics);
router.post("/retry", requireDeviceActivated(), ctrl.retry);
router.post("/ack", requireDeviceAllowedForSync(), validate(syncAckSchema), ctrl.ack);
router.get("/devices", requireDeviceActivated(), requireRole("owner", "admin"), ctrl.devices);
router.get("/conflicts", requireDeviceActivated(), requireRole("owner", "admin"), validateQuery(syncConflictListQuerySchema), ctrl.listConflicts);
router.post("/conflicts/report", requireDeviceActivated(), validate(reportSyncConflictSchema), ctrl.reportConflict);
router.post("/resolve-conflict", requireDeviceActivated(), requireRole("owner", "admin"), validate(resolveSyncConflictSchema), ctrl.resolveConflict);
router.get("/pull", requireDeviceAllowedForSync(), validateQuery(pullQuerySchema), ctrl.pull);
router.post("/push", requireDeviceAllowedForSync(), checkPushBatchSize, validate(pushBodySchema), ctrl.push);

export default router;
