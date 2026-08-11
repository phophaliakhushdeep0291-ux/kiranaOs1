import * as service from "./loyalty.service.js";

const actor = (req) => ({ userId: req.user?.userId ?? null, deviceId: req.user?.deviceId ?? undefined, req });

export async function program(req, res, next) { try { res.json({ success: true, data: await service.getProgram(req.shopId) }); } catch (error) { next(error); } }
export async function updateProgram(req, res, next) { try { const data = await service.updateProgram(req.shopId, req.body, actor(req)); res.json({ success: true, data }); } catch (error) { next(error); } }
export async function accounts(req, res, next) { try { res.json({ success: true, data: await service.listAccounts(req.shopId, { limit: req.query.limit, offset: req.query.offset }) }); } catch (error) { next(error); } }
export async function account(req, res, next) { try { res.json({ success: true, data: await service.getAccount(req.shopId, req.params.customerId) }); } catch (error) { next(error); } }
export async function redeem(req, res, next) { try { const data = await service.redeemPoints(req.shopId, req.params.customerId, { ...req.body, locationId: req.operationalLocation?.id }, actor(req)); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
