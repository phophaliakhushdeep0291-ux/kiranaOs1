import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";
import {
  closeAccountingPeriod,
  createAccount,
  createAccountingPeriod,
  createManualJournal,
  ensureSystemAccounts,
  getBalanceSheet,
  getJournal,
  getProfitAndLoss,
  getTrialBalance,
  listAccountingPeriods,
  projectShopGeneralLedger,
  reverseJournal,
  updateAccount,
} from "./general-ledger.service.js";

const safe = (value) => JSON.parse(JSON.stringify(value, (_key, item) => (
  typeof item === "bigint" ? Number(item) : item
)));
const actorId = (req) => req.user?.userId ?? req.user?.id ?? null;

async function writeRequiredLedgerAudit(req, action, entityType, entityId, after, metadata, client) {
  const audit = await createAuditLog({
    shopId: req.shopId,
    userId: actorId(req),
    module: AUDIT_MODULES.FINANCE,
    action,
    entityType,
    entityId,
    after,
    metadata,
    req,
    client,
  });
  if (!audit) {
    throw new AppError(
      "The ledger change was not saved because its audit record could not be stored",
      503,
      "GENERAL_LEDGER_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

async function runAuditedLedgerMutation(req, operation, auditEntry) {
  return db.$transaction(async (tx) => {
    const data = safe(await operation(tx));
    const entry = auditEntry(data);
    await writeRequiredLedgerAudit(
      req,
      entry.action,
      entry.entityType,
      entry.entityId ?? null,
      entry.after ?? data,
      entry.metadata,
      tx,
    );
    return data;
  });
}

export async function accounts(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => ensureSystemAccounts(req.shopId, tx),
      () => ({
        action: "LEDGER_SYSTEM_ACCOUNTS_ENSURED",
        entityType: "ChartOfAccount",
        after: { systemAccountCount: 19 },
      }),
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function project(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => projectShopGeneralLedger(req.shopId, tx),
      (result) => ({
        action: "LEDGER_PROJECTED",
        entityType: "JournalEntry",
        after: result,
      }),
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function trialBalance(req, res, next) {
  try {
    res.json({ success: true, data: await getTrialBalance(req.shopId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function addAccount(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => createAccount(req.shopId, req.body, tx),
      (result) => ({ action: "LEDGER_ACCOUNT_CREATED", entityType: "ChartOfAccount", entityId: result.id }),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function editAccount(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => updateAccount(req.shopId, req.params.id, req.body, tx),
      (result) => ({ action: "LEDGER_ACCOUNT_UPDATED", entityType: "ChartOfAccount", entityId: result.id }),
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function openingBalances(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => createManualJournal(req.shopId, req.body, {
        sourceType: "opening_balance",
        actorUserId: actorId(req),
        client: tx,
      }),
      (result) => ({ action: "LEDGER_OPENING_BALANCE_POSTED", entityType: "JournalEntry", entityId: result.id }),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function manualJournal(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => createManualJournal(req.shopId, req.body, { actorUserId: actorId(req), client: tx }),
      (result) => ({ action: "LEDGER_MANUAL_JOURNAL_POSTED", entityType: "JournalEntry", entityId: result.id }),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function journal(req, res, next) {
  try {
    res.json({ success: true, data: safe(await getJournal(req.shopId, req.params.id)) });
  } catch (error) {
    next(error);
  }
}

export async function reverse(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => reverseJournal(req.shopId, req.params.id, req.body, actorId(req), tx),
      (result) => ({
        action: "LEDGER_JOURNAL_REVERSED",
        entityType: "JournalEntry",
        entityId: result.id,
        metadata: { reversedJournalId: req.params.id },
      }),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function periods(req, res, next) {
  try {
    res.json({ success: true, data: await listAccountingPeriods(req.shopId) });
  } catch (error) {
    next(error);
  }
}

export async function addPeriod(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => createAccountingPeriod(req.shopId, req.body, tx),
      (result) => ({ action: "LEDGER_PERIOD_CREATED", entityType: "AccountingPeriod", entityId: result.id }),
    );
    res.status(201).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function closePeriod(req, res, next) {
  try {
    const data = await runAuditedLedgerMutation(
      req,
      (tx) => closeAccountingPeriod(req.shopId, req.params.id, req.body, actorId(req), tx),
      (result) => ({ action: "LEDGER_PERIOD_CLOSED", entityType: "AccountingPeriod", entityId: result.id }),
    );
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function profitAndLoss(req, res, next) {
  try {
    res.json({ success: true, data: await getProfitAndLoss(req.shopId, req.query) });
  } catch (error) {
    next(error);
  }
}

export async function balanceSheet(req, res, next) {
  try {
    res.json({ success: true, data: await getBalanceSheet(req.shopId, req.query) });
  } catch (error) {
    next(error);
  }
}

export const __generalLedgerControllerInternals = {
  runAuditedLedgerMutation,
  writeRequiredLedgerAudit,
};
