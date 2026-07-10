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

const MAX_ORDER_LINES = 100;
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

// Customer-facing stage for each internal status, so the tracker reads like a real online order.
const ORDER_STAGE = { new: "received", accepted: "preparing", fulfilled: "ready", rejected: "declined" };

function parseOrderLines(json) {
  try {
    const parsed = JSON.parse(json || "[]");
    if (!Array.isArray(parsed)) return [];
    return parsed.map((l) => ({ name: l.name, qty: l.qty, price: l.price, unit: l.unit }));
  } catch {
    return [];
  }
}

/**
 * Public order-status lookup for the customer's own tracker. The orderId is an unguessable cuid
 * that only the customer who placed it holds, so echoing back its status is safe — and we return
 * only order-shaped fields (status, lines, totals), never other customers' data. Same owner-opt-in
 * 404 gate as the catalog so a disabled/unknown shop leaks nothing.
 */
export async function getPublicOrderStatus(shopId, orderId) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }
  const order = await db.customerOrder.findFirst({
    where: { id: String(orderId ?? ""), shopId },
    select: { id: true, status: true, itemCount: true, estimatedTotal: true, itemsJson: true, createdAt: true, updatedAt: true },
  });
  if (!order) throw new AppError("We couldn't find that order.", 404);
  return {
    orderId: order.id,
    status: order.status,
    stage: ORDER_STAGE[order.status] ?? order.status,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
    items: parseOrderLines(order.itemsJson),
    shopName: shop.name,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

function cleanOrderIdempotencyKey(value) {
  const key = String(value ?? "").trim();
  if (!key) return null;
  return key.replace(/[^a-zA-Z0-9:_-]/g, "").slice(0, 120) || null;
}

function shapeOrderSubmitResponse(order, shopName, duplicate = false) {
  return {
    orderId: order.id,
    itemCount: order.itemCount,
    estimatedTotal: order.estimatedTotal,
    shopName,
    duplicate,
  };
}

/**
 * A customer submits an order from the public QR page. We re-price every line from the shop's own
 * catalog (never trust client-sent prices) and store it in the owner's "Orders Received" inbox.
 * Only open when the owner has enabled customer ordering — same 404 gate as the catalog.
 */
export async function createPublicOrder(shopId, body = {}, options = {}) {
  const shop = await db.shop.findUnique({ where: { id: shopId } });
  if (!shop || !isCustomerOrderingEnabled(shop.settingsJson)) {
    throw new AppError("This shop is not accepting online orders.", 404);
  }

  const idempotencyKey = cleanOrderIdempotencyKey(options.idempotencyKey ?? body.idempotencyKey);
  if (idempotencyKey) {
    const existing = await db.customerOrder.findFirst({
      where: { shopId, idempotencyKey },
      select: { id: true, itemCount: true, estimatedTotal: true, createdAt: true },
    });
    if (existing) return shapeOrderSubmitResponse(existing, shop.name, true);
  }

  const customerName = String(body.customerName ?? "").trim();
  const customerMobile = String(body.customerMobile ?? "").trim();
  const customerAddress = String(body.customerAddress ?? "").trim();
  const note = String(body.note ?? "").trim();
  if (customerName.length < 2) throw new AppError("Please enter your name.", 400);
  if (!/^[6-9]\d{9}$/.test(customerMobile.replace(/[\s-]/g, ""))) {
    throw new AppError("Please enter a valid 10-digit mobile number.", 400);
  }

  const rawItems = Array.isArray(body.items) ? body.items : [];
  if (rawItems.length === 0) throw new AppError("Add at least one item to your order.", 400);
  if (rawItems.length > MAX_ORDER_LINES) throw new AppError("Too many items in one order.", 400);

  // Authoritative catalog re-price: the customer only sends productId + qty.
  const products = await listProducts(shopId);
  const byId = new Map(products.map((p) => [p.id, p]));
  const lines = [];
  for (const raw of rawItems) {
    const product = byId.get(String(raw.productId ?? ""));
    const qty = round2(raw.qty ?? raw.quantity ?? 0);
    if (!product || qty <= 0) continue;
    if (product.status === "inactive" || product.isActive === false) continue;
    const safe = toCustomerSafeProduct(product);
    lines.push({ productId: safe.id, name: safe.name, unit: safe.unit, price: safe.price, qty });
  }
  if (lines.length === 0) throw new AppError("None of the selected items are available.", 400);

  const itemCount = lines.length;
  const estimatedTotal = round2(lines.reduce((sum, l) => sum + l.qty * l.price, 0));

  try {
    const order = await db.customerOrder.create({
      data: {
        shopId,
        customerName: customerName.slice(0, 120),
        customerMobile: customerMobile.replace(/[\s-]/g, "").slice(0, 15),
        customerAddress: customerAddress ? customerAddress.slice(0, 400) : null,
        note: note ? note.slice(0, 400) : null,
        itemsJson: JSON.stringify(lines),
        itemCount,
        estimatedTotal,
        status: "new",
        idempotencyKey,
      },
      select: { id: true, itemCount: true, estimatedTotal: true, createdAt: true },
    });

    return shapeOrderSubmitResponse(order, shop.name);
  } catch (error) {
    if (idempotencyKey && error?.code === "P2002") {
      const existing = await db.customerOrder.findFirst({
        where: { shopId, idempotencyKey },
        select: { id: true, itemCount: true, estimatedTotal: true, createdAt: true },
      });
      if (existing) return shapeOrderSubmitResponse(existing, shop.name, true);
    }
    throw error;
  }
}
