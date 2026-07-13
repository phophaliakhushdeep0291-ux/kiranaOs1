import * as service from "./loyalty.service.js";

export async function program(req, res, next) { try { res.json({ success: true, data: await service.getProgram(req.shopId) }); } catch (error) { next(error); } }
export async function updateProgram(req, res, next) { try { res.json({ success: true, data: await service.updateProgram(req.shopId, req.body) }); } catch (error) { next(error); } }
export async function accounts(req, res, next) { try { res.json({ success: true, data: await service.listAccounts(req.shopId, req.query.limit) }); } catch (error) { next(error); } }
export async function account(req, res, next) { try { res.json({ success: true, data: await service.getAccount(req.shopId, req.params.customerId) }); } catch (error) { next(error); } }
export async function redeem(req, res, next) { try { res.status(201).json({ success: true, data: await service.redeemPoints(req.shopId, req.params.customerId, req.body) }); } catch (error) { next(error); } }

