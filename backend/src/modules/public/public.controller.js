import * as svc from "./public.service.js";

export async function catalog(req, res, next) {
  try {
    const data = await svc.getPublicCatalog(req.params.shopId);
    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
}
