import * as svc from "./udhar.service.js";

export async function getLedger(req, res, next) {
  try {
    const data = await svc.getUdharLedger(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function getSummary(req, res, next) {
  try {
    const data = await svc.getUdharSummary(req.shopId);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
