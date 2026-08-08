import { createAuditLog } from "../audit/audit.service.js";
import * as service from "./channel-settlement.service.js";

function actor(req) { return { userId: req.user?.userId ?? req.user?.id ?? null }; }

export async function imports(req, res, next) {
  try { res.json({ success: true, data: await service.listChannelSettlementImports(req.shopId, req.query) }); }
  catch (error) { next(error); }
}

export async function importSettlement(req, res, next) {
  try {
    const data = await service.importChannelSettlement(req.shopId, req.body, actor(req));
    if (!data.idempotentReplay) {
      await createAuditLog({
        shopId: req.shopId,
        userId: actor(req).userId,
        action: "CHANNEL_SETTLEMENT_IMPORTED",
        entityType: "channel_settlement_import",
        entityId: data.id,
        after: { provider: data.provider, locationId: data.locationId, fileName: data.fileName, rowCount: data.rowCount, gross: data.gross, paidNet: data.paidNet, variance: data.variance },
        req,
      });
    }
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
    await createAuditLog({
      shopId: req.shopId,
      userId: actor(req).userId,
      action: `CHANNEL_SETTLEMENT_${req.body.action.toUpperCase()}`,
      entityType: "channel_settlement_row",
      entityId: req.params.id,
      after: { resolutionStatus: data.resolutionStatus, matchedCustomerOrderId: data.matchedCustomerOrderId, matchedBillId: data.matchedBillId, bankStatementTransactionId: data.bankStatementTransactionId },
      metadata: { reason: req.body.reason ?? null },
      req,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
