import * as svc from "./pricing.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

export function pricingActor(req) {
  const requestDeviceId = Array.isArray(req.headers?.["x-device-id"])
    ? req.headers["x-device-id"][0]
    : req.headers?.["x-device-id"];
  return {
    userId: req.user?.userId ?? req.user?.id ?? null,
    role: req.user?.role,
    // A legacy login session may not yet be bound to its activated device even
    // though requireDeviceActivated has resolved the current request header.
    // Audit the verified request device first so permanent price changes never
    // lose their originating terminal.
    deviceId: req.device?.deviceId ?? req.user?.deviceId ?? requestDeviceId ?? undefined,
    req,
  };
}

export async function evaluate(req, res, next) {
  try { res.json({ success: true, data: await svc.evaluate(req.shopId, { ...req.body, locationId: req.operationalLocation?.id ?? requestLocationId(req) }) }); }
  catch (err) { next(err); }
}

export async function listRules(req, res, next) {
  try { res.json({ success: true, data: await svc.listRules(req.shopId, { ...req.query, locationId: req.operationalLocation?.id ?? requestLocationId(req) }) }); }
  catch (err) { next(err); }
}

export async function createRule(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createRule(req.shopId, req.body, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function updateRule(req, res, next) {
  try { res.json({ success: true, data: await svc.updateRule(req.shopId, req.params.id, req.body, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function deleteRule(req, res, next) {
  try { res.json({ success: true, data: await svc.archiveRule(req.shopId, req.params.id, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function productPricing(req, res, next) {
  try { res.json({ success: true, data: await svc.getProductPricing(req.shopId, req.params.productId, req.operationalLocation?.id ?? requestLocationId(req)) }); }
  catch (err) { next(err); }
}

export async function getSettings(req, res, next) {
  try { res.json({ success: true, data: await svc.getPricingSettings(req.shopId) }); }
  catch (err) { next(err); }
}

export async function updateSettings(req, res, next) {
  try { res.json({ success: true, data: await svc.updatePricingSettings(req.shopId, req.body, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function listSellingUnits(req, res, next) {
  try { res.json({ success: true, data: await svc.listSellingUnits(req.shopId, req.params.productId) }); }
  catch (err) { next(err); }
}

export async function createSellingUnit(req, res, next) {
  try { res.status(201).json({ success: true, data: await svc.createSellingUnit(req.shopId, req.params.productId, req.body, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function updateSellingUnit(req, res, next) {
  try { res.json({ success: true, data: await svc.updateSellingUnit(req.shopId, req.params.productId, req.params.unitId, req.body, pricingActor(req)) }); }
  catch (err) { next(err); }
}

export async function deleteSellingUnit(req, res, next) {
  try { res.json({ success: true, data: await svc.archiveSellingUnit(req.shopId, req.params.productId, req.params.unitId, pricingActor(req)) }); }
  catch (err) { next(err); }
}
