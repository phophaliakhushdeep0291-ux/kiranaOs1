import * as service from "./stockCounts.service.js";
import { requestLocationId } from "../stores/location-context.service.js";

const actor = (req) => ({
  userId: req.user?.userId ?? null,
  deviceId: req.user?.deviceId ?? null,
  note: req.body?.note ?? null,
  req,
});

export async function list(req, res, next) { try { res.json({ success: true, data: await service.listStockCounts(req.shopId, requestLocationId(req), req.query) }); } catch (error) { next(error); } }
export async function get(req, res, next) { try { res.json({ success: true, data: await service.getStockCount(req.shopId, requestLocationId(req), req.params.id) }); } catch (error) { next(error); } }
export async function create(req, res, next) { try { const data = await service.createStockCount(req.shopId, requestLocationId(req), req.body, actor(req)); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function updateLines(req, res, next) { try { res.json({ success: true, data: await service.updateStockCountLines(req.shopId, requestLocationId(req), req.params.id, req.body, actor(req)) }); } catch (error) { next(error); } }
export async function submit(req, res, next) { try { const data = await service.submitStockCount(req.shopId, requestLocationId(req), req.params.id, actor(req)); res.json({ success: true, data }); } catch (error) { next(error); } }
export async function apply(req, res, next) { try { const data = await service.applyStockCount(req.shopId, requestLocationId(req), req.params.id, actor(req)); res.json({ success: true, data }); } catch (error) { next(error); } }
export async function cancel(req, res, next) { try { const data = await service.cancelStockCount(req.shopId, requestLocationId(req), req.params.id, actor(req)); res.json({ success: true, data }); } catch (error) { next(error); } }
