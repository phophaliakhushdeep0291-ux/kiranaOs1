import * as svc from "./integrations.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { AppError } from "../../middleware/error.js";

const ok = (res, data, status = 200) => res.status(status).json({ success: true, data });
async function audit(req, action, entityType, entityId, metadata = {}) { await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action, entityType, entityId, metadata, req }); }

export async function overview(req, res, next) { try { ok(res, await svc.getOverview(req.shopId)); } catch (e) { next(e); } }
export async function keys(req, res, next) { try { ok(res, await svc.listApiKeys(req.shopId)); } catch (e) { next(e); } }
export async function createKey(req, res, next) { try { const data = await svc.createApiKey({ shopId: req.shopId, userId: req.user?.userId, input: req.body }); await audit(req, "INTEGRATION_API_KEY_CREATED", "IntegrationApiKey", data.id, { name: data.name, scopes: data.scopes }); ok(res, data, 201); } catch (e) { next(e); } }
export async function revokeKey(req, res, next) { try { await svc.revokeApiKey(req.shopId, req.params.id); await audit(req, "INTEGRATION_API_KEY_REVOKED", "IntegrationApiKey", req.params.id); ok(res, { revoked: true }); } catch (e) { next(e); } }
export async function endpoints(req, res, next) { try { ok(res, await svc.listWebhookEndpoints(req.shopId)); } catch (e) { next(e); } }
export async function createEndpoint(req, res, next) { try { const data = await svc.createWebhookEndpoint({ shopId: req.shopId, userId: req.user?.userId, input: req.body }); await audit(req, "WEBHOOK_ENDPOINT_CREATED", "WebhookEndpoint", data.id, { name: data.name, events: data.events }); ok(res, data, 201); } catch (e) { next(e); } }
export async function updateEndpoint(req, res, next) { try { const data = await svc.updateWebhookEndpoint(req.shopId, req.params.id, req.body); await audit(req, "WEBHOOK_ENDPOINT_UPDATED", "WebhookEndpoint", data.id, { enabled: data.enabled, events: data.events }); ok(res, data); } catch (e) { next(e); } }
export async function deleteEndpoint(req, res, next) { try { await svc.deleteWebhookEndpoint(req.shopId, req.params.id); await audit(req, "WEBHOOK_ENDPOINT_ARCHIVED", "WebhookEndpoint", req.params.id); ok(res, { archived: true }); } catch (e) { next(e); } }
export async function deliveries(req, res, next) { try { ok(res, await svc.listWebhookDeliveries(req.shopId, req.query)); } catch (e) { next(e); } }
export async function testEndpoint(req, res, next) { try { const data = await svc.testWebhookEndpoint(req.shopId, req.params.id); await audit(req, "WEBHOOK_ENDPOINT_TESTED", "WebhookEndpoint", req.params.id, { deliveryId: data.id, status: data.status }); ok(res, data); } catch (e) { next(e); } }
export async function retryDelivery(req, res, next) { try { const data = await svc.retryWebhookDelivery(req.shopId, req.params.id); await audit(req, "WEBHOOK_DELIVERY_RETRIED", "WebhookDelivery", req.params.id, { status: data.status }); ok(res, data); } catch (e) { next(e); } }
export async function apiResource(req, res, next) { try { const resource = req.params.resource; const scope = { catalog: "catalog:read", customers: "customers:read", bills: "bills:read" }[resource]; if (!scope) throw new AppError("API resource not found", 404, "INTEGRATION_RESOURCE_NOT_FOUND"); ok(res, await svc.listApiResource({ shopId: req.integration.shopId, resource, scope: req.integration.scopes.includes(scope), query: req.query })); } catch (e) { next(e); } }
export async function tally(req, res, next) { try { const data = await svc.buildTallyExport(req.shopId, req.query); res.setHeader("content-type", "application/xml; charset=utf-8"); res.setHeader("content-disposition", `attachment; filename="${data.filename}"`); res.setHeader("x-kiranaos-record-count", String(data.count)); res.send(data.xml); } catch (e) { next(e); } }
