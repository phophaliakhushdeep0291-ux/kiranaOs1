import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import * as ctrl from "./jobs.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner", "admin"));

router.get("/status", ctrl.status);
router.get("/failed", ctrl.failed);
router.get("/workers", ctrl.workerHealth);
router.get("/backups", ctrl.shopBackups);
router.post("/backups", requireOwnerPin, ctrl.createShopBackup);
router.get("/backups/:id/download", requireOwnerPin, ctrl.downloadShopBackup);
router.post("/backups/:id/restore-preview", requireOwnerPin, ctrl.previewShopBackupRestore);
router.get("/queues/:queueName", ctrl.queueDetail);
router.get("/queues/:queueName/failed", ctrl.queueFailed);
router.post("/:queueName/:jobId/retry", requireOwnerPin, ctrl.retry);
router.post("/:queueName/:jobId/discard", requireOwnerPin, ctrl.discard);

export default router;
