import * as service from "./purchaseReturns.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

export async function list(req, res, next) { try { res.json({ success: true, data: await service.listPurchaseReturns(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); } catch (error) { next(error); } }
export async function create(req, res, next) { try { const data = await service.createPurchaseReturn(req.shopId, req.body, actor(req), requestLocationId(req)); if (!data.idempotentReplay) { await publishIntegrationEvent(req.shopId, "purchase_return.created", { id: data.id, returnNumber: data.returnNumber, totalAmount: data.totalAmount, supplierId: data.supplierId, locationId: data.locationId }).catch(() => []); } res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data }); } catch (error) { next(error); } }
export async function cancel(req, res, next) { try { const data = await service.cancelPurchaseReturn(req.shopId, req.params.id, req.body.reason, actor(req), requestLocationId(req)); if (!data.idempotentReplay) { await publishIntegrationEvent(req.shopId, "purchase_return.cancelled", { id: data.id, returnNumber: data.returnNumber, totalAmount: data.totalAmount, supplierId: data.supplierId, locationId: data.locationId }).catch(() => []); } res.json({ success: true, data }); } catch (error) { next(error); } }
