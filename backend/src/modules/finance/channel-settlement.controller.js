import * as service from "./channel-settlement.service.js";

function actor(req) {
  return {
    userId: req.user?.userId ?? req.user?.id ?? null,
    deviceId: req.user?.deviceId ?? undefined,
    req,
  };
}

export async function imports(req, res, next) {
  try { res.json({ success: true, data: await service.listChannelSettlementImports(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function importSettlement(req, res, next) {
  try {
    const data = await service.importChannelSettlement(req.shopId, req.body, actor(req));
    res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function report(req, res, next) {
  try { res.json({ success: true, data: await service.getChannelSettlementReport(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function resolve(req, res, next) {
  try {
    const data = await service.resolveChannelSettlementRow(req.shopId, req.params.id, req.body, actor(req));
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
