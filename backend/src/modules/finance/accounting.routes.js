import { Router } from "express";
import { requireAuth, requireRole } from "../../middleware/auth.js";
import { requireOwnerPin, requireShop } from "../../middleware/permissions.js";
import { validate, validateQuery } from "../../middleware/validate.js";
import { requireDeviceActivated } from "../devices/device.middleware.js";
import { requireFeature } from "../feature-gates/featureGate.middleware.js";
import { accountingControlQuerySchema } from "./accounting-control.schema.js";
import {
  bankReconciliationIgnoreSchema,
  bankReconciliationMatchSchema,
  bankReconciliationQuerySchema,
  bankReconciliationRestoreSchema,
  bankReconciliationUnmatchSchema,
  bankStatementImportSchema,
  bankStatementListQuerySchema,
} from "./bank-reconciliation.schema.js";
import * as controller from "./accounting-control.controller.js";
import * as bankController from "./bank-reconciliation.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner"));
router.get("/control", validateQuery(accountingControlQuerySchema), controller.control);
router.get("/bank-statements", requireFeature("csv_import_export"), validateQuery(bankStatementListQuerySchema), bankController.imports);
router.post("/bank-statements/import", requireFeature("csv_import_export"), requireOwnerPin, validate(bankStatementImportSchema), bankController.importStatement);
router.get("/bank-reconciliation", requireFeature("csv_import_export"), validateQuery(bankReconciliationQuerySchema), bankController.reconciliation);
router.post("/bank-transactions/:id/match", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationMatchSchema), bankController.match);
router.post("/bank-transactions/:id/unmatch", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationUnmatchSchema), bankController.unmatch);
router.post("/bank-transactions/:id/ignore", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationIgnoreSchema), bankController.ignore);
router.post("/bank-transactions/:id/restore", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationRestoreSchema), bankController.restore);

export default router;