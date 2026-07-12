import * as svc from "./pricing.service.js";

function actor(req) {
  return { userId: req.user?.userId ?? req.user?.id ?? null, role: req.user?.role, deviceId: req.get("x-device-id") || null };
}

export async function evaluate(req, res, next) {
  try { res.json({ success: true, data: await svc.evaluate(req.shopId, req.body) }); }
  catch (err) { next(err); }
}

export async function listRules(req, res, next) {
  try { res.json({ success: true, data: await svc.listRules(req.shopId, req.query) }); }
  catch (err) { next(err); }
}

export async function createRule(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createRule(req.shopId, req.body, actor(req)) }); }
  catch (err) { next(err); }
}

export async function updateRule(req, res, next) {
  try { res.json({ success: true, data: await svc.updateRule(req.shopId, req.params.id, req.body, actor(req)) }); }
  catch (err) { next(err); }
}

export async function deleteRule(req, res, next) {
  try { res.json({ success: true, data: await svc.archiveRule(req.shopId, req.params.id, actor(req)) }); }
  catch (err) { next(err); }
}

export async function productPricing(req, res, next) {
  try { res.json({ success: true, data: await svc.getProductPricing(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

export async function getSettings(req, res, next) {
  try { res.json({ success: true, data: await svc.getPricingSettings(req.shopId) }); }
  catch (err) { next(err); }
}

export async function updateSettings(req, res, next) {
  try { res.json({ success: true, data: await svc.updatePricingSettings(req.shopId, req.body, actor(req)) }); }
  catch (err) { next(err); }
}
