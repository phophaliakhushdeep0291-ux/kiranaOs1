import * as svc from "./customers.service.js";

export async function list(req, res, next) {
  try {
    const data = await svc.listCustomers(req.shopId, req.query);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function get(req, res, next) {
  try {
    const data = await svc.getCustomer(req.shopId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function create(req, res, next) {
  try {
    const data = await svc.createCustomer(req.shopId, req.body);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = await svc.updateCustomer(req.shopId, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function remove(req, res, next) {
  try {
    await svc.softDeleteCustomer(req.shopId, req.params.id, {
      actorUserId: req.user?.userId ?? null,
      req,
    });
    res.json({ success: true, message: "Customer deleted" });
  } catch (err) { next(err); }
}

export async function getKhata(req, res, next) {
  try {
    const data = await svc.getKhata(req.shopId, req.params.id);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}

export async function udharPayment(req, res, next) {
  try {
    const data = await svc.recordUdharPayment(req.shopId, req.params.id, req.body);
    res.json({ success: true, data });
  } catch (err) { next(err); }
}


export async function reverseUdharPayment(req, res, next) {
  try {
    const data = await svc.reverseUdharPayment(
      req.shopId,
      req.params.id,
      req.params.ledgerId,
      req.body,
      { actorUserId: req.user?.userId ?? null, req }
    );
    res.json({ success: true, data });
  } catch (err) { next(err); }
}
