import * as service from "./giftCards.service.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

export async function list(req, res, next) { try { res.json({ success: true, data: await service.listGiftCards(req.shopId, req.query) }); } catch (error) { next(error); } }
export async function lookup(req, res, next) { try { res.json({ success: true, data: await service.lookupGiftCard(req.shopId, req.body.code) }); } catch (error) { next(error); } }
export async function issue(req, res, next) { try { const data = await service.issueGiftCard(req.shopId, req.body, actor(req)); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function disable(req, res, next) { try { const data = await service.disableGiftCard(req.shopId, req.params.id, req.body.reason, actor(req)); res.json({ success: true, data }); } catch (error) { next(error); } }
