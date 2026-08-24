import { closeAccountingPeriod, createAccount, createAccountingPeriod, createManualJournal, ensureSystemAccounts, getBalanceSheet, getJournal, getProfitAndLoss, getTrialBalance, listAccountingPeriods, projectShopGeneralLedger, reverseJournal, updateAccount } from "./general-ledger.service.js";
import { AUDIT_MODULES, createAuditLog } from "../audit/audit.service.js";

const safe = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));
const actorId = (req) => req.user?.userId ?? req.user?.id ?? null;
const audit = (req, action, entityType, entityId, after, metadata) => createAuditLog({
  shopId: req.shopId,
  userId: actorId(req),
  module: AUDIT_MODULES.FINANCE,
  action,
  entityType,
  entityId,
  after,
  metadata,
  req,
});

export async function accounts(req, res, next) {
  try { res.json({ success: true, data: await ensureSystemAccounts(req.shopId) }); }
  catch (error) { next(error); }
}

export async function project(req, res, next) {
  try {
    const data = await projectShopGeneralLedger(req.shopId);
    await audit(req, "LEDGER_PROJECTED", "JournalEntry", null, data);
    res.json({ success: true, data });
  }
  catch (error) { next(error); }
}

export async function trialBalance(req, res, next) {
  try { res.json({ success: true, data: await getTrialBalance(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function addAccount(req, res, next) { try { const data = await createAccount(req.shopId, req.body); await audit(req, "LEDGER_ACCOUNT_CREATED", "ChartOfAccount", data.id, data); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function editAccount(req, res, next) { try { const data = await updateAccount(req.shopId, req.params.id, req.body); await audit(req, "LEDGER_ACCOUNT_UPDATED", "ChartOfAccount", data.id, data); res.json({ success: true, data }); } catch (error) { next(error); } }
export async function openingBalances(req, res, next) { try { const data = safe(await createManualJournal(req.shopId, req.body, { sourceType: "opening_balance", actorUserId: actorId(req) })); await audit(req, "LEDGER_OPENING_BALANCE_POSTED", "JournalEntry", data.id, data); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function manualJournal(req, res, next) { try { const data = safe(await createManualJournal(req.shopId, req.body, { actorUserId: actorId(req) })); await audit(req, "LEDGER_MANUAL_JOURNAL_POSTED", "JournalEntry", data.id, data); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function journal(req, res, next) { try { res.json({ success: true, data: safe(await getJournal(req.shopId, req.params.id)) }); } catch (error) { next(error); } }
export async function reverse(req, res, next) { try { const data = safe(await reverseJournal(req.shopId, req.params.id, req.body, actorId(req))); await audit(req, "LEDGER_JOURNAL_REVERSED", "JournalEntry", data.id, data, { reversedJournalId: req.params.id }); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function periods(req, res, next) { try { res.json({ success: true, data: await listAccountingPeriods(req.shopId) }); } catch (error) { next(error); } }
export async function addPeriod(req, res, next) { try { const data = await createAccountingPeriod(req.shopId, req.body); await audit(req, "LEDGER_PERIOD_CREATED", "AccountingPeriod", data.id, data); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function closePeriod(req, res, next) { try { const data = await closeAccountingPeriod(req.shopId, req.params.id, req.body, actorId(req)); await audit(req, "LEDGER_PERIOD_CLOSED", "AccountingPeriod", data.id, data); res.json({ success: true, data }); } catch (error) { next(error); } }
export async function profitAndLoss(req, res, next) { try { res.json({ success: true, data: await getProfitAndLoss(req.shopId, req.query) }); } catch (error) { next(error); } }
export async function balanceSheet(req, res, next) { try { res.json({ success: true, data: await getBalanceSheet(req.shopId, req.query) }); } catch (error) { next(error); } }
