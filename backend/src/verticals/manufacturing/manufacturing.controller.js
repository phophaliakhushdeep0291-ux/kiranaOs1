import * as service from "./manufacturing.service.js";

export async function overview(req, res, next) { try { res.json({ success: true, data: await service.overview(req.shopId) }); } catch (e) { next(e); } }
export async function boms(req, res, next) { try { res.json({ success: true, data: await service.listBoms(req.shopId) }); } catch (e) { next(e); } }
export async function createBom(req, res, next) { try { res.status(201).json({ success: true, data: await service.createBom(req.shopId, req.body) }); } catch (e) { next(e); } }
export async function createRun(req, res, next) { try { res.status(201).json({ success: true, data: await service.createRun(req.shopId, { ...req.body, locationId: req.operationalLocation?.id ?? req.body.locationId }) }); } catch (e) { next(e); } }
export async function completeRun(req, res, next) { try { res.json({ success: true, data: await service.completeRun(req.shopId, req.params.id, req.body) }); } catch (e) { next(e); } }
export async function trace(req, res, next) { try { res.json({ success: true, data: await service.traceBatch(req.shopId, req.query.batchNumber) }); } catch (e) { next(e); } }
export async function releaseRun(req, res, next) { try { res.json({ success: true, data: await service.releaseRun(req.shopId, req.params.id) }); } catch (e) { next(e); } }
