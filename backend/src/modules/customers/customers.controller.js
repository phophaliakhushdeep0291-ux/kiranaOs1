import * as svc from "./customers.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";

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
    const data = await svc.createCustomer(req.shopId, req.body, {
      actor: {
        userId: req.user?.userId ?? null,
        deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
        req,
      },
    });
    await publishIntegrationEvent(req.shopId, "customer.updated", { id: data.id, name: data.name, mobile: data.mobile, type: data.type, customerGroup: data.customerGroup, udharAmount: data.udharAmount, operation: "created", updatedAt: data.updatedAt }).catch(() => []);
    res.status(201).json({ success: true, data });
  } catch (err) { next(err); }
}

export async function update(req, res, next) {
  try {
    const data = await svc.updateCustomer(req.shopId, req.params.id, req.body);
    await publishIntegrationEvent(req.shopId, "customer.updated", { id: data.id, name: data.name, mobile: data.mobile, type: data.type, customerGroup: data.customerGroup, udharAmount: data.udharAmount, operation: "updated", updatedAt: data.updatedAt }).catch(() => []);
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
    const data = await svc.recordUdharPayment(req.shopId, req.params.id, req.body, {
      deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : null,
      locationId: requestLocationId(req),
      userId: req.user?.userId ?? null,
      req,
    });
    await publishIntegrationEvent(req.shopId, "payment.recorded", { customerId: req.params.id, amount: req.body.amount, paymentMode: req.body.paymentMode ?? null, referenceId: data.id ?? null, recordedAt: new Date().toISOString() }).catch(() => []);
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
