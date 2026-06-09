import * as svc from "./suppliers.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listSuppliers(req.shopId) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createSupplier(req.shopId, req.body) }); }
  catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateSupplier(req.shopId, req.params.id, req.body) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const supplier = await svc.softDeleteSupplier(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SUPPLIER_DELETED",
      entityType: "Supplier",
      entityId: supplier.id,
      after: { id: supplier.id, name: supplier.name, deletedAt: supplier.deletedAt },
      metadata: { softDelete: true },
      req,
    });
    res.json({ success: true, message: "Supplier moved to recycle bin", data: supplier });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const supplier = await svc.restoreSupplier(req.shopId, req.params.id);
    await createAuditLog({
      shopId: req.shopId,
      userId: req.user?.userId,
      action: "SUPPLIER_RESTORED",
      entityType: "Supplier",
      entityId: supplier.id,
      after: { id: supplier.id, name: supplier.name, deletedAt: supplier.deletedAt },
      metadata: { softDelete: false },
      req,
    });
    res.json({ success: true, message: "Supplier restored", data: supplier });
  } catch (err) { next(err); }
}

export async function bestPrice(req, res, next) {
  try { res.json({ success: true, data: await svc.getBestPrice(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}
