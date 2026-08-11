import * as service from "./bank-reconciliation.service.js";

function actor(req) {
  return {
    userId: req.user?.userId ?? req.user?.id ?? null,
    deviceId: req.user?.deviceId ?? undefined,
    req,
  };
}

export async function imports(req, res, next) {
  try {
    res.json({ success: true, data: await service.listBankStatementImports(req.shopId, req.query) });
  } catch (error) { next(error); }
}

export async function importStatement(req, res, next) {
  try {
    const data = await service.importBankStatement(req.shopId, req.body, actor(req));
    res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function reconciliation(req, res, next) {
  try {
    res.json({ success: true, data: await service.getBankReconciliation(req.shopId, req.query) });
  } catch (error) { next(error); }
}

export async function match(req, res, next) {
  try {
    const data = await service.matchBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function unmatch(req, res, next) {
  try {
    const data = await service.unmatchBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function ignore(req, res, next) {
  try {
    const data = await service.ignoreBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function restore(req, res, next) {
  try {
    const data = await service.restoreBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
