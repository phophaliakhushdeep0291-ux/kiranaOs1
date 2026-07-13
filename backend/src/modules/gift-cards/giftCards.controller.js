import * as service from "./giftCards.service.js";
import { createAuditLog } from "../audit/audit.service.js";

export async function list(req, res, next) { try { res.json({ success: true, data: await service.listGiftCards(req.shopId, req.query) }); } catch (error) { next(error); } }
export async function lookup(req, res, next) { try { res.json({ success: true, data: await service.lookupGiftCard(req.shopId, req.body.code) }); } catch (error) { next(error); } }
export async function issue(req, res, next) { try { const data = await service.issueGiftCard(req.shopId, req.body, { userId: req.user?.userId }); await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "GIFT_CARD_ISSUED", entityType: "GiftCard", entityId: data.id, metadata: { amount: data.initialBalance, codeLast4: data.codeLast4, customerId: data.customerId }, req }); res.status(201).json({ success: true, data }); } catch (error) { next(error); } }
export async function disable(req, res, next) { try { const data = await service.disableGiftCard(req.shopId, req.params.id, req.body.reason); await createAuditLog({ shopId: req.shopId, userId: req.user?.userId, action: "GIFT_CARD_DISABLED", entityType: "GiftCard", entityId: data.id, metadata: { reason: req.body.reason, balance: data.balance }, req }); res.json({ success: true, data }); } catch (error) { next(error); } }
