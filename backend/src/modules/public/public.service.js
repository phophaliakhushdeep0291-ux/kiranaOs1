import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { listProducts } from "../products/products.service.js";

/**
 * Public, unauthenticated read of a shop's catalog for the QR customer self-order page.
 *
 * Privacy model (owner opt-in): a shop is only exposed here if its owner has turned on
 * "Customer QR ordering" (persisted at settingsJson.customerOrdering.enabled). Even then we
 * return ONLY storefront-safe fields — name, unit, selling price, MRP, image, category — and
 * never cost, margin, minimum price, stock, GST internals, or any customer data. Each request
 * is strictly scoped to the requested shopId, so this is deliberate single-shop exposure, not a
 * cross-tenant read.
 */

export function isCustomerOrderingEnabled(settingsJson) {
  if (!settingsJson) return false;
  try {
    const parsed = JSON.parse(settingsJson);
    return parsed?.customerOrdering?.enabled === true;
  } catch {
    return false;
  }
}

export function toCustomerSafeProduct(p) {
  return {
    id: p.id,
    name: p.name,
    category: p.category ?? null,
    unit: p.displayUnit || p.rateUnit || p.unit || "piece",
    price: Number(p.defaultPricePerRateUnit ?? 0),
    mrp: p.mrp != null ? Number(p.mrp) : null,
    imageUrl: p.imageUrl ?? null,
  };
}

export async function getPublicCatalog(shopId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  // One 404 for both "no such shop" and "ordering disabled" so we never leak which shop ids
  // exist or whether a real shop has the feature turned off.
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }

  const products = await listProducts(shopId);
  const safe = products
    .filter((p) => p.status !== "inactive" && p.isActive !== false)
    .map(toCustomerSafeProduct);

  return {
    shop: { id: shop.id, name: shop.name, city: shop.city ?? null },
    products: safe,
  };
}
