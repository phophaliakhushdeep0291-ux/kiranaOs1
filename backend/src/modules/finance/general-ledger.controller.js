import { ensureSystemAccounts, getTrialBalance, projectShopGeneralLedger } from "./general-ledger.service.js";

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
