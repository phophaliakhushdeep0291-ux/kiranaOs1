import * as service from "./bins.service.js";

export async function list(req, res, next) {
  try { res.json({ success: true, data: await service.listBins(req.shopId, req.query.locationId) }); } catch (error) { next(error); }
}

export async function create(req, res, next) {
  try {
    const data = await service.createBin(req.shopId, req.body, req.user, req);
    res.status(201).json({ success: true, data });
  } catch (error) { next(error); }
}

export async function update(req, res, next) {
  try { res.json({ success: true, data: await service.updateBin(req.shopId, req.params.id, req.body, req.user, req) }); } catch (error) { next(error); }
}

export async function map(req, res, next) {
  try { res.json({ success: true, data: await service.getBinMap(req.shopId, req.query.locationId, req.query) }); } catch (error) { next(error); }
}

export async function move(req, res, next) {
  try { res.json({ success: true, data: await service.movePlacement(req.shopId, req.body, req.user, req) }); } catch (error) { next(error); }
}

export async function reconcile(req, res, next) {
  try { res.json({ success: true, data: await service.reconcilePlacements(req.shopId, req.body, req.user, req) }); } catch (error) { next(error); }
}
