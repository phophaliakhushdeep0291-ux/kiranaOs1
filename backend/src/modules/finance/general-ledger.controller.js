import { closeAccountingPeriod, createAccount, createAccountingPeriod, createManualJournal, ensureSystemAccounts, getBalanceSheet, getJournal, getProfitAndLoss, getTrialBalance, listAccountingPeriods, projectShopGeneralLedger, reverseJournal, updateAccount } from "./general-ledger.service.js";

const safe = (value) => JSON.parse(JSON.stringify(value, (_key, item) => typeof item === "bigint" ? Number(item) : item));

export async function accounts(req, res, next) {
  try { res.json({ success: true, data: await ensureSystemAccounts(req.shopId) }); }
  catch (error) { next(error); }
}

export async function project(req, res, next) {
  try { res.json({ success: true, data: await projectShopGeneralLedger(req.shopId) }); }
  catch (error) { next(error); }
}

export async function trialBalance(req, res, next) {
  try { res.json({ success: true, data: await getTrialBalance(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function addAccount(req, res, next) { try { res.status(201).json({ success: true, data: await createAccount(req.shopId, req.body) }); } catch (error) { next(error); } }
export async function editAccount(req, res, next) { try { res.json({ success: true, data: await updateAccount(req.shopId, req.params.id, req.body) }); } catch (error) { next(error); } }
export async function openingBalances(req, res, next) { try { res.status(201).json({ success: true, data: safe(await createManualJournal(req.shopId, req.body, { sourceType: "opening_balance", actorUserId: req.user?.userId ?? req.user?.id })) }); } catch (error) { next(error); } }
export async function manualJournal(req, res, next) { try { res.status(201).json({ success: true, data: safe(await createManualJournal(req.shopId, req.body, { actorUserId: req.user?.userId ?? req.user?.id })) }); } catch (error) { next(error); } }
export async function journal(req, res, next) { try { res.json({ success: true, data: safe(await getJournal(req.shopId, req.params.id)) }); } catch (error) { next(error); } }
export async function reverse(req, res, next) { try { res.status(201).json({ success: true, data: safe(await reverseJournal(req.shopId, req.params.id, req.body, req.user?.userId ?? req.user?.id)) }); } catch (error) { next(error); } }
export async function periods(req, res, next) { try { res.json({ success: true, data: await listAccountingPeriods(req.shopId) }); } catch (error) { next(error); } }
export async function addPeriod(req, res, next) { try { res.status(201).json({ success: true, data: await createAccountingPeriod(req.shopId, req.body) }); } catch (error) { next(error); } }
export async function closePeriod(req, res, next) { try { res.json({ success: true, data: await closeAccountingPeriod(req.shopId, req.params.id, req.body, req.user?.userId ?? req.user?.id) }); } catch (error) { next(error); } }
export async function profitAndLoss(req, res, next) { try { res.json({ success: true, data: await getProfitAndLoss(req.shopId, req.query) }); } catch (error) { next(error); } }
export async function balanceSheet(req, res, next) { try { res.json({ success: true, data: await getBalanceSheet(req.shopId, req.query) }); } catch (error) { next(error); } }
