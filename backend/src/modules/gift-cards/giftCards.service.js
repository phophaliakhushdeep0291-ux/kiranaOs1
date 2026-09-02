import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { fromPaise, toPaise } from "../../utils/money.js";
import { createAuditLog } from "../audit/audit.service.js";

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

async function writeRequiredGiftCardAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Gift-card action was not saved because its audit record could not be stored",
      503,
      "GIFT_CARD_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function randomPart(length = 4) {
  const bytes = crypto.randomBytes(length);
  return [...bytes].map((byte) => ALPHABET[byte % ALPHABET.length]).join("");
}

function generateCode() {
  return `KOS-${randomPart()}-${randomPart()}-${randomPart()}`;
}

function normalizeCode(code) {
  return String(code || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashCode(shopId, code) {
  return crypto.createHash("sha256").update(`${shopId}:${normalizeCode(code)}`).digest("hex");
}

function parseExpiry(value) {
  if (!value) return null;
  const date = new Date(`${value}T23:59:59.999Z`);
  return Number.isFinite(date.getTime()) ? date : null;
}

function publicCard(card, { code } = {}) {
  return {
    ...card,
    initialBalance: fromPaise(Number(card.initialBalancePaise)),
    balance: fromPaise(Number(card.balancePaise)),
    ...(code ? { code } : {}),
    codeHash: undefined,
    transactions: card.transactions?.map((row) => ({
      ...row,
      amount: fromPaise(Number(row.amountPaise)),
      balanceAfter: fromPaise(Number(row.balanceAfterPaise)),
    })),
  };
}

export async function listGiftCards(shopId, { status, limit }) {
  const now = new Date();
  const statusWhere = status === "all" ? {}
    : status === "expired" ? { OR: [{ status: "expired" }, { status: "active", expiresAt: { lt: now } }] }
      : status === "active" ? { status: "active", OR: [{ expiresAt: null }, { expiresAt: { gte: now } }] }
        : { status };
  const cards = await db.giftCard.findMany({
    where: { shopId, ...statusWhere },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { customer: { select: { id: true, name: true, mobile: true } }, transactions: { orderBy: { createdAt: "desc" }, take: 10 } },
  });
  return cards.map((card) => publicCard({ ...card, status: card.status === "active" && card.expiresAt && card.expiresAt < now ? "expired" : card.status }));
}

export async function issueGiftCard(shopId, data, actor = {}) {
  const amountPaise = BigInt(toPaise(data.amount));
  const customer = data.customerId ? await db.customer.findFirst({ where: { id: data.customerId, shopId, deletedAt: null } }) : null;
  if (data.customerId && !customer) throw new AppError("Customer not found", 404, "GIFT_CARD_CUSTOMER_NOT_FOUND");
  const code = generateCode();
  const card = await db.$transaction(async (tx) => {
    const created = await tx.giftCard.create({ data: {
      shopId,
      customerId: customer?.id ?? null,
      codeHash: hashCode(shopId, code),
      codeLast4: normalizeCode(code).slice(-4),
      initialBalancePaise: amountPaise,
      balancePaise: amountPaise,
      expiresAt: parseExpiry(data.expiresOn),
      note: data.note ?? null,
      createdByUserId: actor.userId ?? null,
    } });
    await tx.giftCardTransaction.create({ data: { shopId, giftCardId: created.id, type: "issue", amountPaise, balanceAfterPaise: amountPaise, note: data.note ?? "Gift card issued", createdByUserId: actor.userId ?? null } });
    const result = await tx.giftCard.findUnique({ where: { id: created.id }, include: { customer: { select: { id: true, name: true, mobile: true } }, transactions: true } });
    await writeRequiredGiftCardAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      req: actor.req ?? null,
      action: "GIFT_CARD_ISSUED",
      entityType: "GiftCard",
      entityId: created.id,
      after: { initialBalancePaise: amountPaise, balancePaise: amountPaise, status: created.status },
      metadata: { codeLast4: created.codeLast4, customerId: created.customerId, expiresAt: created.expiresAt, note: created.note },
    }, tx);
    return result;
  });
  return publicCard(card, { code });
}

export async function issueReturnCreditInTransaction(tx, { shopId, customerId, billId, locationId, amount, userId, note }) {
  const code = generateCode();
  const amountPaise = BigInt(toPaise(amount));
  const card = await tx.giftCard.create({ data: {
    shopId,
    customerId: customerId ?? null,
    codeHash: hashCode(shopId, code),
    codeLast4: normalizeCode(code).slice(-4),
    initialBalancePaise: amountPaise,
    balancePaise: amountPaise,
    note: note ?? "Issued for sale return",
    createdByUserId: userId ?? null,
  } });
  await tx.giftCardTransaction.create({ data: { shopId, giftCardId: card.id, billId, locationId, type: "return_credit", amountPaise, balanceAfterPaise: amountPaise, note: note ?? "Sale return issued as gift value", createdByUserId: userId ?? null } });
  return publicCard(card, { code });
}

export async function lookupGiftCard(shopId, code) {
  const card = await db.giftCard.findUnique({ where: { shopId_codeHash: { shopId, codeHash: hashCode(shopId, code) } }, include: { customer: { select: { id: true, name: true, mobile: true } } } });
  if (!card) throw new AppError("Gift card not found", 404, "GIFT_CARD_NOT_FOUND");
  const expired = card.expiresAt && card.expiresAt < new Date();
  return publicCard({ ...card, status: expired && card.status === "active" ? "expired" : card.status });
}

export async function disableGiftCard(shopId, id, reason, actor = {}) {
  const card = await db.$transaction(async (tx) => {
    const existing = await tx.giftCard.findFirst({ where: { id, shopId } });
    if (!existing || !["active", "depleted"].includes(existing.status)) {
      throw new AppError("Gift card is already disabled or unavailable", 409, "GIFT_CARD_NOT_DISABLEABLE");
    }
    const disabledAt = new Date();
    const changed = await tx.giftCard.updateMany({
      where: { id, shopId, status: existing.status },
      data: { status: "disabled", disabledAt, note: reason },
    });
    if (changed.count !== 1) throw new AppError("Gift card changed while disabling; retry", 409, "GIFT_CARD_CONCURRENT_CHANGE");
    const result = await tx.giftCard.findUnique({ where: { id }, include: { customer: { select: { id: true, name: true, mobile: true } }, transactions: { orderBy: { createdAt: "desc" }, take: 10 } } });
    await writeRequiredGiftCardAudit({
      shopId,
      userId: actor.userId ?? null,
      deviceId: actor.deviceId ?? undefined,
      req: actor.req ?? null,
      action: "GIFT_CARD_DISABLED",
      entityType: "GiftCard",
      entityId: id,
      before: { status: existing.status, balancePaise: existing.balancePaise },
      after: { status: "disabled", balancePaise: result.balancePaise, disabledAt },
      metadata: { reason, codeLast4: existing.codeLast4 },
    }, tx);
    return result;
  });
  return publicCard(card);
}

export async function reserveGiftCardPayments(tx, { shopId, payments }) {
  const requested = new Map();
  for (const payment of payments.filter((row) => row.mode === "gift_card")) {
    const code = payment.giftCardCode ?? payment.gift_card_code;
    if (!code) throw new AppError("Gift card code is required", 422, "GIFT_CARD_CODE_REQUIRED");
    const codeHash = hashCode(shopId, code);
    const amountPaise = BigInt(toPaise(Number(payment.amount)));
    const existing = requested.get(codeHash);
    requested.set(codeHash, { codeHash, amountPaise: (existing?.amountPaise ?? 0n) + amountPaise });
  }
  const reservations = [];
  for (const request of requested.values()) {
    const card = await tx.giftCard.findUnique({ where: { shopId_codeHash: { shopId, codeHash: request.codeHash } } });
    if (!card) throw new AppError("Gift card not found", 404, "GIFT_CARD_NOT_FOUND");
    if (card.status !== "active") throw new AppError(`Gift card ending ${card.codeLast4} is ${card.status}`, 409, "GIFT_CARD_INACTIVE");
    if (card.expiresAt && card.expiresAt < new Date()) throw new AppError(`Gift card ending ${card.codeLast4} has expired`, 409, "GIFT_CARD_EXPIRED");
    if (card.balancePaise < request.amountPaise) throw new AppError(`Gift card ending ${card.codeLast4} has only Rs ${fromPaise(Number(card.balancePaise)).toFixed(2)} available`, 409, "GIFT_CARD_INSUFFICIENT_BALANCE");
    const changed = await tx.giftCard.updateMany({
      where: { id: card.id, shopId, status: "active", balancePaise: { gte: request.amountPaise }, OR: [{ expiresAt: null }, { expiresAt: { gte: new Date() } }] },
      data: { balancePaise: { decrement: request.amountPaise } },
    });
    if (changed.count !== 1) throw new AppError(`Gift card ending ${card.codeLast4} changed while billing. Check its balance and retry.`, 409, "GIFT_CARD_CONCURRENT_REDEMPTION");
    let updated = await tx.giftCard.findUnique({ where: { id: card.id } });
    if (updated.balancePaise === 0n) updated = await tx.giftCard.update({ where: { id: card.id }, data: { status: "depleted" } });
    reservations.push({ cardId: card.id, codeLast4: card.codeLast4, amountPaise: request.amountPaise, balanceAfterPaise: updated.balancePaise });
  }
  return reservations;
}

export async function recordGiftCardRedemptions(tx, { shopId, bill, locationId, reservations, userId }) {
  for (const row of reservations) await tx.giftCardTransaction.create({ data: {
    shopId,
    giftCardId: row.cardId,
    billId: bill.id,
    locationId,
    type: "redeem",
    amountPaise: -row.amountPaise,
    balanceAfterPaise: row.balanceAfterPaise,
    note: `Redeemed on ${bill.billNo}`,
    createdByUserId: userId ?? null,
  } });
}

export async function reverseGiftCardRedemptions(tx, shopId, billId, { userId, note } = {}) {
  const transactions = await tx.giftCardTransaction.findMany({ where: { shopId, billId } });
  const byCard = new Map();
  for (const row of transactions) {
    const current = byCard.get(row.giftCardId) ?? { netPaise: 0n, locationId: row.locationId };
    current.netPaise += row.amountPaise;
    byCard.set(row.giftCardId, current);
  }
  for (const [giftCardId, state] of byCard) {
    if (state.netPaise >= 0n) continue;
    const amountPaise = -state.netPaise;
    // A card the shop disabled — reported lost, stolen, or withdrawn — stays
    // disabled. The value goes back onto its balance so the gift-card ledger
    // still adds up against its transactions, but cancelling a bill must not
    // quietly hand a blocked card back to whoever is holding it. Any other
    // status, depleted included, becomes spendable again as it should.
    const existing = await tx.giftCard.findUnique({ where: { id: giftCardId } });
    const card = await tx.giftCard.update({
      where: { id: giftCardId },
      data: { balancePaise: { increment: amountPaise }, ...(existing?.status === "disabled" ? {} : { status: "active" }) },
    });
    await tx.giftCardTransaction.create({ data: { shopId, giftCardId: card.id, billId, locationId: state.locationId, type: `redemption_reversal_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`, amountPaise, balanceAfterPaise: card.balancePaise, note: note ?? "Bill cancellation restored gift card value", createdByUserId: userId ?? null } });
  }
}

export async function reapplyGiftCardRedemptions(tx, shopId, billId, { userId, note } = {}) {
  const transactions = await tx.giftCardTransaction.findMany({ where: { shopId, billId } });
  const original = transactions.filter((row) => row.type === "redeem");
  if (!original.length) return;
  const byCard = new Map();
  for (const row of transactions) byCard.set(row.giftCardId, (byCard.get(row.giftCardId) ?? 0n) + row.amountPaise);
  for (const redemption of original) {
    const currentNet = byCard.get(redemption.giftCardId) ?? 0n;
    if (currentNet < 0n) continue;
    const amountPaise = -redemption.amountPaise;
    const card = await tx.giftCard.findUnique({ where: { id: redemption.giftCardId } });
    if (!card || card.status === "disabled" || (card.expiresAt && card.expiresAt < new Date()) || card.balancePaise < amountPaise) throw new AppError(`Cannot restore bill because gift card ending ${card?.codeLast4 ?? "unknown"} is unavailable or has insufficient balance`, 409, "GIFT_CARD_RESTORE_UNAVAILABLE");
    const updated = await tx.giftCard.update({ where: { id: card.id }, data: { balancePaise: { decrement: amountPaise }, ...(card.balancePaise === amountPaise ? { status: "depleted" } : {}) } });
    await tx.giftCardTransaction.create({ data: { shopId, giftCardId: card.id, billId, locationId: redemption.locationId, type: `restore_redeem_${Date.now()}_${crypto.randomBytes(2).toString("hex")}`, amountPaise: -amountPaise, balanceAfterPaise: updated.balancePaise, note: note ?? "Restored bill re-applied gift card redemption", createdByUserId: userId ?? null } });
  }
}

export const __giftCardInternals = { normalizeCode, hashCode };
