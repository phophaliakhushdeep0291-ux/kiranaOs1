import { createAuditLog } from "../audit/audit.service.js";
import * as service from "./bank-reconciliation.service.js";

function actor(req) {
  return { userId: req.user?.userId ?? req.user?.id ?? null };
}

export async function imports(req, res, next) {
  try {
    res.json({ success: true, data: await service.listBankStatementImports(req.shopId, req.query) });
  } catch (error) { next(error); }
}

export async function importStatement(req, res, next) {
  try {
    const data = await service.importBankStatement(req.shopId, req.body, actor(req));
    if (!data.idempotentReplay) {
      await createAuditLog({
        shopId: req.shopId,
        userId: actor(req).userId,
        action: "BANK_STATEMENT_IMPORTED",
        entityType: "bank_statement_import",
        entityId: data.id,
        after: {
          accountType: data.accountType,
          accountName: data.accountName,
          accountLast4: data.accountLast4,
          fileName: data.fileName,
          rowCount: data.rowCount,
          importedCount: data.importedCount,
          duplicateCount: data.duplicateCount,
          note: req.body.note ?? null,
        },
        req,
      });
    }
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
    await createAuditLog({
      shopId: req.shopId,
      userId: actor(req).userId,
      action: "BANK_RECONCILIATION_MATCHED",
      entityType: "bank_statement_transaction",
      entityId: req.params.id,
      after: data,
      req,
    });
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function unmatch(req, res, next) {
  try {
    const data = await service.unmatchBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    await createAuditLog({
      shopId: req.shopId,
      userId: actor(req).userId,
      action: "BANK_RECONCILIATION_UNMATCHED",
      entityType: "bank_statement_transaction",
      entityId: req.params.id,
      after: data,
      metadata: { reason: req.body.reason },
      req,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function ignore(req, res, next) {
  try {
    const data = await service.ignoreBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    await createAuditLog({
      shopId: req.shopId,
      userId: actor(req).userId,
      action: "BANK_RECONCILIATION_IGNORED",
      entityType: "bank_statement_transaction",
      entityId: req.params.id,
      after: data,
      metadata: { reason: req.body.reason },
      req,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}

export async function restore(req, res, next) {
  try {
    const data = await service.restoreBankTransaction(req.shopId, req.params.id, req.body, actor(req));
    await createAuditLog({
      shopId: req.shopId,
      userId: actor(req).userId,
      action: "BANK_RECONCILIATION_RESTORED",
      entityType: "bank_statement_transaction",
      entityId: req.params.id,
      after: data,
      metadata: { reason: req.body.reason },
      req,
    });
    res.json({ success: true, data });
  } catch (error) { next(error); }
}
