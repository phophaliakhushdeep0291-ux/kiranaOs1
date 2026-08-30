import * as shopService from "./shops.service.js";

export async function getShop(req, res, next) {
  try {
    const shop = await shopService.getShop(req.shopId);
    res.json({ success: true, data: shop });
  } catch (err) { next(err); }
}

export async function getBootstrap(req, res, next) {
  try {
    const data = await shopService.getBootstrap(req.shopId, req.user?.role ?? null);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateShop(req, res, next) {
  try {
    const shop = await shopService.updateShop(req.shopId, req.body, {
      userId: req.user?.userId ?? null,
      role: req.user?.role ?? null,
      req,
    });
    res.json({ success: true, data: shop });
  } catch (err) { next(err); }
}

export async function businessTypeCompatibility(req, res, next) {
  try {
    const data = await shopService.getBusinessTypeCompatibility(req.shopId, req.body.targetBusinessType, { userId: req.user?.userId, req });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function updateSetupStatus(req, res, next) {
  try {
    const data = await shopService.updateSetupStatus(req.shopId, req.body.status, { userId: req.user?.userId, role: req.user?.role, req });
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

