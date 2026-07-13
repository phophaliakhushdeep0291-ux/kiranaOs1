import * as service from "./purchaseReturns.service.js";
import { requestLocationId } from "../stores/location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { publishIntegrationEvent } from "../integrations/integrations.service.js";

export async function list(req, res, next) { try { res.json({ success: true, data: await service.listPurchaseReturns(req.shopId, { ...req.query, locationId: requestLocationId(req) }) }); } catch (error) { next(error); } }
export async function create(req, res, next) { try { const data = await service.createPurchaseReturn(req.shopId, req.body, req.user?.userId); if (!data.idempotentReplay) { await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "PURCHASE_RETURN_CREATED", entityType: "PurchaseReturn", entityId: data.id, after: { returnNumber: data.returnNumber, totalAmount: data.totalAmount, refundMode: data.refundMode }, metadata: { purchaseReceiptId: data.purchaseReceiptId, locationId: data.locationId }, req }); await publishIntegrationEvent(req.shopId, "purchase_return.created", { id: data.id, returnNumber: data.returnNumber, totalAmount: data.totalAmount, supplierId: data.supplierId, locationId: data.locationId }).catch(() => []); } res.status(data.idempotentReplay ? 200 : 201).json({ success: true, data }); } catch (error) { next(error); } }
