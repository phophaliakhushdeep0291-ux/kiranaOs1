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
import * as generalLedgerController from "./general-ledger.controller.js";
import { accountCreateSchema, accountUpdateSchema, balanceSheetQuerySchema, journalCreateSchema, openingBalanceSchema, periodCloseSchema, periodCreateSchema, reversalSchema } from "./general-ledger.schema.js";
import * as bankController from "./bank-reconciliation.controller.js";
import {
  channelSettlementImportQuerySchema,
  channelSettlementImportSchema,
  channelSettlementReportQuerySchema,
  channelSettlementResolveSchema,
} from "./channel-settlement.schema.js";
import * as channelController from "./channel-settlement.controller.js";

const router = Router();
router.use(requireAuth, requireShop, requireDeviceActivated(), requireRole("owner"));
router.get("/control", validateQuery(accountingControlQuerySchema), controller.control);
router.get("/chart-of-accounts", generalLedgerController.accounts);
router.post("/chart-of-accounts", requireOwnerPin, validate(accountCreateSchema), generalLedgerController.addAccount);
router.patch("/chart-of-accounts/:id", requireOwnerPin, validate(accountUpdateSchema), generalLedgerController.editAccount);
router.post("/general-ledger/project", requireOwnerPin, generalLedgerController.project);
router.get("/trial-balance", validateQuery(accountingControlQuerySchema), generalLedgerController.trialBalance);
router.get("/profit-and-loss", validateQuery(accountingControlQuerySchema), generalLedgerController.profitAndLoss);
router.get("/balance-sheet", validateQuery(balanceSheetQuerySchema), generalLedgerController.balanceSheet);
router.post("/opening-balances", requireOwnerPin, validate(openingBalanceSchema), generalLedgerController.openingBalances);
router.post("/journals", requireOwnerPin, validate(journalCreateSchema), generalLedgerController.manualJournal);
router.get("/journals/:id", generalLedgerController.journal);
router.post("/journals/:id/reverse", requireOwnerPin, validate(reversalSchema), generalLedgerController.reverse);
router.get("/periods", generalLedgerController.periods);
router.post("/periods", requireOwnerPin, validate(periodCreateSchema), generalLedgerController.addPeriod);
router.post("/periods/:id/close", requireOwnerPin, validate(periodCloseSchema), generalLedgerController.closePeriod);
router.get("/bank-statements", requireFeature("csv_import_export"), validateQuery(bankStatementListQuerySchema), bankController.imports);
router.post("/bank-statements/import", requireFeature("csv_import_export"), requireOwnerPin, validate(bankStatementImportSchema), bankController.importStatement);
router.get("/bank-reconciliation", requireFeature("csv_import_export"), validateQuery(bankReconciliationQuerySchema), bankController.reconciliation);
router.post("/bank-transactions/:id/match", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationMatchSchema), bankController.match);
router.post("/bank-transactions/:id/unmatch", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationUnmatchSchema), bankController.unmatch);
router.post("/bank-transactions/:id/ignore", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationIgnoreSchema), bankController.ignore);
router.post("/bank-transactions/:id/restore", requireFeature("csv_import_export"), requireOwnerPin, validate(bankReconciliationRestoreSchema), bankController.restore);
router.get("/channel-settlement-imports", requireFeature("channel_settlement"), validateQuery(channelSettlementImportQuerySchema), channelController.imports);
router.post("/channel-settlements/import", requireFeature("channel_settlement"), requireOwnerPin, validate(channelSettlementImportSchema), channelController.importSettlement);
router.get("/channel-settlements", requireFeature("channel_settlement"), validateQuery(channelSettlementReportQuerySchema), channelController.report);
router.post("/channel-settlement-rows/:id/resolve", requireFeature("channel_settlement"), requireOwnerPin, validate(channelSettlementResolveSchema), channelController.resolve);

export default router;
