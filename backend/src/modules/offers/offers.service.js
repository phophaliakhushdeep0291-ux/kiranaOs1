import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";

function normalize(data) {
  const out = { ...data };
  if (out.code !== undefined) out.code = out.code ? String(out.code).trim().toUpperCase() : null;
  for (const k of ["value", "minBillAmount", "maxDiscount"]) {
    if (out[k] !== undefined) out[k] = round2(Number(out[k]) || 0);
  }
  if (out.usageLimit !== undefined) out.usageLimit = Math.max(0, Math.floor(Number(out.usageLimit) || 0));
  for (const k of ["validFrom", "validTo"]) {
    if (out[k] !== undefined) out[k] = out[k] ? new Date(out[k]) : null;
  }
  return out;
}

export async function listOffers(shopId) {
  return db.offer.findMany({ where: { shopId, deletedAt: null }, orderBy: { createdAt: "desc" } });
}

export async function getOffer(shopId, id) {
  const offer = await db.offer.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!offer) throw new AppError("Offer not found", 404);
  return offer;
}

export async function createOffer(shopId, data) {
  return db.offer.create({ data: { ...normalize(data), shopId } });
}

export async function updateOffer(shopId, id, data) {
  await getOffer(shopId, id);
  return db.offer.update({ where: { id }, data: normalize(data) });
}

export async function softDeleteOffer(shopId, id) {
  const offer = await getOffer(shopId, id);
  return db.offer.update({ where: { id: offer.id }, data: { deletedAt: new Date() } });
}

export async function restoreOffer(shopId, id) {
  const offer = await db.offer.findFirst({ where: { id, shopId, deletedAt: { not: null } } });
  if (!offer) throw new AppError("Deleted offer not found in recycle bin", 404);
  return db.offer.update({ where: { id: offer.id }, data: { deletedAt: null } });
}

function computeDiscount(offer, subtotal) {
  if (offer.type === "flat") return round2(Math.min(offer.value, subtotal));
  const raw = subtotal * (offer.value / 100);
  const capped = offer.maxDiscount > 0 ? Math.min(raw, offer.maxDiscount) : raw;
  return round2(Math.min(capped, subtotal));
}

function isLive(offer, now) {
  if (!offer.active) return false;
  if (offer.validFrom && now < offer.validFrom) return false;
  if (offer.validTo && now > offer.validTo) return false;
  if (offer.usageLimit > 0 && offer.usedCount >= offer.usageLimit) return false;
  return true;
}

function offerError(message, status, code) {
  return new AppError(message, status, code);
}

export async function validateOfferForBill(client, shopId, { offerId, code, subtotal }) {
  if (!offerId) return null;
  const offer = await client.offer.findFirst({ where: { id: offerId, shopId, deletedAt: null } });
  if (!offer) throw offerError("Coupon no longer exists", 409, "OFFER_NOT_AVAILABLE");

  const normalizedCode = code ? String(code).trim().toUpperCase() : null;
  if (offer.code && offer.code.toUpperCase() !== normalizedCode) {
    throw offerError("Coupon code does not match the selected offer", 409, "OFFER_CODE_MISMATCH");
  }
  if (!isLive(offer, new Date())) throw offerError("Coupon is paused, expired, or used up", 409, "OFFER_NOT_AVAILABLE");
  if (subtotal < offer.minBillAmount) {
    throw offerError(`Coupon requires a minimum bill of Rs ${offer.minBillAmount}`, 409, "OFFER_MINIMUM_NOT_MET");
  }

  const discount = computeDiscount(offer, subtotal);
  if (discount <= 0) throw offerError("Coupon does not produce a valid discount", 409, "OFFER_NOT_APPLICABLE");
  return { offer, discount };
}

export async function redeemOfferInTransaction(client, shopId, validatedOffer, { isEstimate = false } = {}) {
  if (!validatedOffer || isEstimate) return null;
  const { offer, discount } = validatedOffer;
  const now = new Date();
  const claimed = await client.offer.updateMany({
    where: {
      id: offer.id,
      shopId,
      deletedAt: null,
      active: true,
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validTo: null }, { validTo: { gte: now } }] },
        { OR: [{ usageLimit: 0 }, { usedCount: { lt: offer.usageLimit } }] },
      ],
    },
    data: {
      usedCount: { increment: 1 },
      discountGiven: { increment: discount },
    },
  });
  if (claimed.count !== 1) {
    throw offerError("Coupon became unavailable while the bill was being saved", 409, "OFFER_REDEMPTION_CONFLICT");
  }
  return { offerId: offer.id, discount };
}

export async function reverseBillOfferRedemption(client, shopId, bill) {
  const discount = round2(Number(bill?.offerDiscount) || 0);
  if (!bill?.offerId || bill.billType === "estimate" || discount <= 0) return null;
  const reversed = await client.offer.updateMany({
    where: {
      id: bill.offerId,
      shopId,
      usedCount: { gt: 0 },
      discountGiven: { gte: discount },
    },
    data: {
      usedCount: { decrement: 1 },
      discountGiven: { decrement: discount },
    },
  });
  if (reversed.count !== 1) {
    throw offerError("Coupon totals could not be reversed safely", 409, "OFFER_REVERSAL_CONFLICT");
  }
  return { offerId: bill.offerId, discount };
}

export async function reapplyBillOfferRedemption(client, shopId, bill) {
  const discount = round2(Number(bill?.offerDiscount) || 0);
  if (!bill?.offerId || bill.billType === "estimate" || discount <= 0) return null;
  const reapplied = await client.offer.updateMany({
    where: { id: bill.offerId, shopId },
    data: {
      usedCount: { increment: 1 },
      discountGiven: { increment: discount },
    },
  });
  if (reapplied.count !== 1) {
    throw offerError("Coupon totals could not be restored safely", 409, "OFFER_REAPPLY_CONFLICT");
  }
  return { offerId: bill.offerId, discount };
}

/**
 * Validate a coupon code (or auto-apply code-less offers) against a bill subtotal
 * and return the best applicable discount. Does not mutate usedCount — that is
 * incremented only when a bill is actually confirmed (see redeemOffer).
 */
export async function applyOffer(shopId, { subtotal, code }) {
  const now = new Date();
  const offers = await db.offer.findMany({ where: { shopId, deletedAt: null, active: true } });
  const normalizedCode = code ? String(code).trim().toUpperCase() : null;

  const candidates = offers.filter((o) => {
    if (!isLive(o, now)) return false;
    if (subtotal < o.minBillAmount) return false;
    if (normalizedCode) return (o.code || "").toUpperCase() === normalizedCode;
    return !o.code;
  });

  if (candidates.length === 0) {
    return {
      applicable: false,
      discount: 0,
      reason: normalizedCode ? "Invalid, expired, or not eligible coupon" : "No offer applies to this bill yet",
    };
  }

  let best = null;
  for (const offer of candidates) {
    const discount = computeDiscount(offer, subtotal);
    if (!best || discount > best.discount) {
      best = { offerId: offer.id, title: offer.title, code: offer.code, type: offer.type, value: offer.value, discount };
    }
  }
  return { applicable: best.discount > 0, ...best };
}

/** Increment usage + accumulated discount after a bill that used the offer is confirmed. */
export async function redeemOffer(shopId, id, discount = 0) {
  void shopId;
  void id;
  void discount;
  throw offerError("Coupons are redeemed only inside bill confirmation", 409, "OFFER_REDEMPTION_REQUIRES_BILL");
}
