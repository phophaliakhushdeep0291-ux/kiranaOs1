import { getAccountingControl } from "./accounting-control.service.js";

export async function control(req, res, next) {
  try {
    res.json({ success: true, data: await getAccountingControl(req.shopId, req.query) });
  } catch (error) {
    next(error);
  }
}