import * as svc from "./integrations.service.js";
import { AppError } from "../../middleware/error.js";
import { downloadFlipkartDocument, flipkartStatus } from "./flipkart-seller.service.js";

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
const actor = (req) => ({
  userId: req.user?.userId ?? null,
  deviceId: req.headers?.["x-device-id"] ? String(req.headers["x-device-id"]) : undefined,
  req,
});

export async function overview(req, res, next) { try { ok(res, await svc.getOverview(req.shopId)); } catch (e) { next(e); } }
export async function keys(req, res, next) { try { ok(res, await svc.listApiKeys(req.shopId)); } catch (e) { next(e); } }
export async function createKey(req, res, next) { try { const data = await svc.createApiKey({ shopId: req.shopId, userId: req.user?.userId, input: req.body, actor: actor(req) }); ok(res, data, 201); } catch (e) { next(e); } }
export async function revokeKey(req, res, next) { try { await svc.revokeApiKey(req.shopId, req.params.id, actor(req)); ok(res, { revoked: true }); } catch (e) { next(e); } }
export async function endpoints(req, res, next) { try { ok(res, await svc.listWebhookEndpoints(req.shopId)); } catch (e) { next(e); } }
export async function createEndpoint(req, res, next) { try { const data = await svc.createWebhookEndpoint({ shopId: req.shopId, userId: req.user?.userId, input: req.body, actor: actor(req) }); ok(res, data, 201); } catch (e) { next(e); } }
export async function updateEndpoint(req, res, next) { try { const data = await svc.updateWebhookEndpoint(req.shopId, req.params.id, req.body, actor(req)); ok(res, data); } catch (e) { next(e); } }
export async function deleteEndpoint(req, res, next) { try { await svc.deleteWebhookEndpoint(req.shopId, req.params.id, actor(req)); ok(res, { archived: true }); } catch (e) { next(e); } }
export async function deliveries(req, res, next) { try { ok(res, await svc.listWebhookDeliveries(req.shopId, req.query)); } catch (e) { next(e); } }
export async function testEndpoint(req, res, next) { try { const data = await svc.testWebhookEndpoint(req.shopId, req.params.id, actor(req)); ok(res, data); } catch (e) { next(e); } }
export async function retryDelivery(req, res, next) { try { const data = await svc.requestWebhookDeliveryRetry(req.shopId, req.params.id, actor(req)); ok(res, data); } catch (e) { next(e); } }
export async function apiResource(req, res, next) { try { const resource = req.params.resource; const scope = { catalog: "catalog:read", customers: "customers:read", bills: "bills:read" }[resource]; if (!scope) throw new AppError("API resource not found", 404, "INTEGRATION_RESOURCE_NOT_FOUND"); ok(res, await svc.listApiResource({ shopId: req.integration.shopId, resource, scope: req.integration.scopes.includes(scope), query: req.query })); } catch (e) { next(e); } }
export async function tally(req, res, next) { try { const data = await svc.buildTallyExport(req.shopId, req.query); res.setHeader("content-type", "application/xml; charset=utf-8"); res.setHeader("content-disposition", `attachment; filename="${data.filename}"`); res.setHeader("x-kiranaos-record-count", String(data.count)); res.setHeader("x-kiranaos-master-count", String(data.masterCount)); res.send(data.xml); } catch (e) { next(e); } }
// The push path needs the document list alongside the XML, which an XML body
// cannot carry, so live sends read JSON here instead of downloading a file.
export async function tallyEnvelope(req, res, next) { try { const data = await svc.buildTallyExport(req.shopId, req.query); ok(res, data); } catch (e) { next(e); } }
export async function tallyPosted(req, res, next) { try { const data = await svc.markTallyPosted(req.shopId, req.body.documents, actor(req)); ok(res, data); } catch (e) { next(e); } }
export async function tallyPush(req, res, next) { try { ok(res, await svc.pushTallyExport(req.shopId, req.query, actor(req))); } catch (e) { next(e); } }
export async function flipkartConnectorStatus(_req, res, next) { try { ok(res, flipkartStatus()); } catch (e) { next(e); } }
export async function flipkartDocument(req, res, next) { try { const pdf = await downloadFlipkartDocument(req.params.shipmentId, req.params.kind); res.setHeader("content-type", "application/pdf"); res.setHeader("content-disposition", `attachment; filename="flipkart-${req.params.kind}-${req.params.shipmentId}.pdf"`); res.send(pdf); } catch (e) { next(e); } }
