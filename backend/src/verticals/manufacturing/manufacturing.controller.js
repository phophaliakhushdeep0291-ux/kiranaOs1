import * as service from "./manufacturing.service.js";
import * as trade from "./trade-orders.service.js";
import { buildTradePdf } from "./trade-documents.service.js";

export async function overview(req, res, next) { try { res.json({ success: true, data: await service.overview(req.shopId) }); } catch (e) { next(e); } }
export async function boms(req, res, next) { try { res.json({ success: true, data: await service.listBoms(req.shopId) }); } catch (e) { next(e); } }
export async function createBom(req, res, next) { try { res.status(201).json({ success: true, data: await service.createBom(req.shopId, req.body) }); } catch (e) { next(e); } }
export async function createRun(req, res, next) { try { res.status(201).json({ success: true, data: await service.createRun(req.shopId, { ...req.body, locationId: req.operationalLocation?.id ?? req.body.locationId }) }); } catch (e) { next(e); } }
export async function completeRun(req, res, next) { try { res.json({ success: true, data: await service.completeRun(req.shopId, req.params.id, req.body) }); } catch (e) { next(e); } }
export async function trace(req, res, next) { try { res.json({ success: true, data: await service.traceBatch(req.shopId, req.query.batchNumber) }); } catch (e) { next(e); } }
export async function releaseRun(req, res, next) { try { res.json({ success: true, data: await service.releaseRun(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function tradeOrders(req, res, next) { try { res.json({ success: true, data: await trade.listTradeOrders(req.shopId, req.query) }); } catch (e) { next(e); } }
export async function tradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.getTradeOrder(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function createTradeOrder(req, res, next) { try { res.status(201).json({ success: true, data: await trade.createTradeOrder(req.shopId, { ...req.body, locationId: req.operationalLocation?.id ?? req.body.locationId }) }); } catch (e) { next(e); } }
export async function confirmTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.confirmTradeOrder(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function allocateTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.allocateTradeOrder(req.shopId, req.params.id, req.body) }); } catch (e) { next(e); } }
export async function autoAllocateTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.autoAllocateTradeOrder(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function packTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.packTradeOrder(req.shopId, req.params.id, req.body) }); } catch (e) { next(e); } }
export async function dispatchTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.dispatchTradeOrder(req.shopId, req.params.id, req.body) }); } catch (e) { next(e); } }
export async function attachTradeBill(req, res, next) { try { res.json({ success: true, data: await trade.attachTradeBill(req.shopId, req.params.id, req.body.billId) }); } catch (e) { next(e); } }
export async function cancelTradeOrder(req, res, next) { try { res.json({ success: true, data: await trade.cancelTradeOrder(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function tradeDocuments(req, res, next) { try { res.json({ success: true, data: await trade.tradeDocuments(req.shopId, req.params.id) }); } catch (e) { next(e); } }
export async function tradeDocumentPdf(req, res, next) { try { const pdf = await buildTradePdf(req.shopId, req.params.id, req.params.kind); res.setHeader("content-type", "application/pdf"); res.setHeader("content-disposition", `attachment; filename="${req.params.kind}-${req.params.id}.pdf"`); res.send(pdf); } catch (e) { next(e); } }
