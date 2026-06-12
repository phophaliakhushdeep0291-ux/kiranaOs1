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
  const offer = await db.offer.findFirst({ where: { id, shopId, deletedAt: null } });
  if (!offer) return null;
  const safeDiscount = round2(Math.max(0, Number(discount) || 0));
  return db.offer.update({
    where: { id: offer.id },
    data: { usedCount: { increment: 1 }, ...(safeDiscount > 0 && { discountGiven: { increment: safeDiscount } }) },
  });
}
