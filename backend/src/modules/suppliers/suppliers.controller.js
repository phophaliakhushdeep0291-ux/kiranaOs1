import * as svc from "./suppliers.service.js";

function actor(req) {
  return {
    userId: req.user?.userId ?? null,
    deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
    req,
  };
}

export async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listSuppliers(req.shopId) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const supplier = await svc.createSupplier(req.shopId, req.body, actor(req));
    // §2 audit "Supplier creation" — matches the delete/restore entries below.
    res.status(201).json({ success: true, data: supplier });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateSupplier(req.shopId, req.params.id, req.body, actor(req)) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const supplier = await svc.softDeleteSupplier(req.shopId, req.params.id, actor(req));
    res.json({ success: true, message: "Supplier moved to recycle bin", data: supplier });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const supplier = await svc.restoreSupplier(req.shopId, req.params.id, actor(req));
    res.json({ success: true, message: "Supplier restored", data: supplier });
  } catch (err) { next(err); }
}

export async function bestPrice(req, res, next) {
  try { res.json({ success: true, data: await svc.getBestPrice(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

export async function statement(req, res, next) {
  try { res.json({ success: true, data: await svc.getSupplierStatement(req.shopId, req.params.id, req.query) }); }
  catch (err) { next(err); }
}

export async function rebuildStatement(req, res, next) {
  try { res.json({ success: true, data: await svc.rebuildSupplierStatement(req.shopId, req.params.id, actor(req)) }); }
  catch (err) { next(err); }
}
