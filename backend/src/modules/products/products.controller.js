import * as svc from "./products.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { lookupProductKnowledge } from "./product-knowledge.service.js";

function actor(req) {
  return {
    userId: req.user?.userId ?? null,
    deviceId: req.user?.deviceId ?? undefined,
    reason: req.body?.ownerPinReason ?? req.body?.auditReason ?? null,
    req,
  };
}

export async function list(req, res, next) {
  try {
    const products = await svc.listProducts(req.shopId, { ...req.query, locationId: requestLocationId(req) });
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

export async function get(req, res, next) {
  try {
    const product = await svc.getProduct(req.shopId, req.params.id, { locationId: requestLocationId(req) });
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function variantStockByLocation(req, res, next) {
  try {
    const data = await svc.getVariantStockByLocation(req.shopId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function lookupKnowledge(req, res, next) {
  try {
    const result = await lookupProductKnowledge(req.params.barcode);
    res.json({ success: true, data: result });
  } catch {
    // Product knowledge is an enrichment path. An upstream outage must fall back to
    // the existing manual capture sheet, never break billing or expose vendor errors.
    res.json({ success: true, data: { found: false, barcode: String(req.params.barcode || ""), reason: "lookup_unavailable" } });
  }
}

export async function create(req, res, next) {
  try {
    const product = await svc.createProduct(req.shopId, req.body, {
      actor: actor(req),
      locationId: requestLocationId(req),
    });
    res.status(201).json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const product = await svc.updateProduct(req.shopId, req.params.id, req.body, {
      actor: actor(req),
      locationId: requestLocationId(req),
    });
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function bindBarcode(req, res, next) {
  try {
    // The service writes its own audit row, because the bind also arrives over sync
    // where there is no request to hang one off.
    const product = await svc.bindProductBarcode(req.shopId, req.params.id, req.body.barcode, {
      req,
      userId: req.user?.userId ?? null,
    });
    res.json({ success: true, data: product });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const product = await svc.softDeleteProduct(req.shopId, req.params.id, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({
      success: true,
      message: "Product moved to recycle bin",
      data: product,
    });
  } catch (err) { next(err); }
}

export async function listDeleted(req, res, next) {
  try {
    const products = await svc.listDeletedProducts(req.shopId, req.query);
    res.json({ success: true, data: products });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const product = await svc.restoreDeletedProduct(req.shopId, req.params.id, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({
      success: true,
      message: "Product restored from recycle bin",
      data: product,
    });
  } catch (err) { next(err); }
}

export async function permanentRemove(req, res, next) {
  try {
    const product = await svc.permanentlyDeleteProduct(req.shopId, req.params.id, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({
      success: true,
      message: "Product permanently deleted",
      data: product,
    });
  } catch (err) { next(err); }
}

export async function emptyRecycleBin(req, res, next) {
  try {
    const result = await svc.emptyProductRecycleBin(req.shopId, {
      userId: req.user?.userId ?? null,
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      req,
    });
    res.json({
      success: true,
      message: "Product recycle bin processed",
      data: result,
    });
  } catch (err) { next(err); }
}
