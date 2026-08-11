import * as svc from "./offers.service.js";

const actor = (req) => ({
  userId: req.user?.userId ?? null,
  deviceId: req.user?.deviceId ?? undefined,
  reason: req.body?.auditReason,
  req,
});

export async function list(req, res, next) {
  try { res.json({ success: true, data: await svc.listOffers(req.shopId) }); }
  catch (err) { next(err); }
}

export async function apply(req, res, next) {
  try { res.json({ success: true, data: await svc.applyOffer(req.shopId, req.body) }); }
  catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const offer = await svc.createOffer(req.shopId, req.body, actor(req));
    res.status(201).json({ success: true, data: offer });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await svc.updateOffer(req.shopId, req.params.id, req.body, actor(req)) }); }
  catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    const offer = await svc.softDeleteOffer(req.shopId, req.params.id, actor(req));
    res.json({ success: true, message: "Offer moved to recycle bin", data: offer });
  } catch (err) { next(err); }
}

export async function restore(req, res, next) {
  try {
    const offer = await svc.restoreOffer(req.shopId, req.params.id, actor(req));
    res.json({ success: true, message: "Offer restored", data: offer });
  } catch (err) { next(err); }
}

export async function redeem(req, res, next) {
  try {
    const offer = await svc.redeemOffer(req.shopId, req.params.id, req.body?.discount);
    res.json({ success: true, data: offer });
  } catch (err) { next(err); }
}
