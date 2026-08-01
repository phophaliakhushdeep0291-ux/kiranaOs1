import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { ensurePrimaryLocation } from "./stores.service.js";

export function requestLocationId(req) {
  if (req?.locationScopeAll === true) return null;
  const values = [req?.body?.locationId, req?.body?.location_id, req?.query?.locationId, req?.headers?.["x-location-id"], req?.operationalLocation?.id];
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return null;
}

export async function resolveOperationalLocation(shopId, requestedLocationId = null, client = db, { allowInactive = false } = {}) {
  if (requestedLocationId) {
    const location = await client.storeLocation.findFirst({
      where: { id: requestedLocationId, shopId, ...(!allowInactive && { active: true }) },
    });
    if (!location) {
      const error = new AppError("The selected store location is unavailable", 409, "STORE_LOCATION_UNAVAILABLE");
      error.publicData = { locationId: requestedLocationId };
      throw error;
    }
    return location;
  }
  return ensurePrimaryLocation(shopId, client);
}

async function allocatedSecondaryQty(client, shopId, productId) {
  const rows = await client.locationStock.findMany({
    where: { shopId, productId },
    select: { stockBaseQty: true },
  });
  return round2(rows.reduce((sum, row) => sum + Number(row.stockBaseQty || 0), 0));
}

export async function getLocationQuantity(client, shopId, location, product) {
  if (!location.isPrimary) {
    const row = await client.locationStock.findUnique({
      where: { locationId_productId: { locationId: location.id, productId: product.id } },
      select: { stockBaseQty: true },
    });
    return round2(row?.stockBaseQty ?? 0);
  }
  const allocated = await allocatedSecondaryQty(client, shopId, product.id);
  return round2(Number(product.stockBaseQty || 0) - allocated);
}

function insufficientLocationStock(location, product, available, requested) {
  const error = new AppError(
    `Insufficient stock for "${product.name}" at ${location.name}. Available: ${available} ${product.baseUnit}, needed: ${requested}`,
    409,
    "INSUFFICIENT_LOCATION_STOCK",
  );
  error.publicData = { locationId: location.id, productId: product.id, availableBaseQty: available, requestedBaseQty: requested };
  return error;
}

/**
 * Move a per_pack product's per-packaging counts in the same transaction as the
 * base-unit movement, so the two can never disagree.
 *
 * Base units stay authoritative: every report, valuation and ledger row keeps
 * reading Product.stockBaseQty exactly as before. The pack counts are a breakdown
 * of that same stock, which is only safe while a single write path maintains both
 * — hence doing it here, in the shared choke point, rather than at each caller.
 *
 * Deliberately never blocks a sale. A pack count is bookkeeping the shopkeeper
 * maintains by hand; if it disagrees with reality, the base-unit check has already
 * decided whether the sale may proceed, and refusing here would block a real sale
 * over a stale count. Packs are allowed to go negative for the same reason base
 * stock is: a visible deficit is what prompts a recount.
 *
 * `packs` is a Map of sellingUnitId -> { sellingUnit, qty }; pooled products pass
 * nothing and are untouched.
 */
async function movePackagingStock(client, { shopId, product, packs, direction }) {
  if (product?.packagingMode !== "per_pack" || !packs?.size) return;
  for (const { sellingUnit, qty } of packs.values()) {
    const amount = round2(qty);
    if (!(amount > 0)) continue;
    await client.productSellingUnit.updateMany({
      where: { id: sellingUnit.id, shopId, productId: product.id },
      data: { onHandQty: direction === "out" ? { decrement: amount } : { increment: amount } },
    });
  }
}

export async function decrementLocationInventory(client, { shopId, location, product, quantityBase, allowShortfall = false, packs = null }) {
  const quantity = round2(quantityBase);
  const oldLocationStock = await getLocationQuantity(client, shopId, location, product);
  if (!allowShortfall && oldLocationStock < quantity) throw insufficientLocationStock(location, product, oldLocationStock, quantity);

  if (!location.isPrimary) {
    if (allowShortfall) {
      await client.locationStock.upsert({
        where: { locationId_productId: { locationId: location.id, productId: product.id } },
        create: { shopId, locationId: location.id, productId: product.id, stockBaseQty: -quantity },
        update: { stockBaseQty: { decrement: quantity } },
      });
    } else {
      const changed = await client.locationStock.updateMany({
        where: { shopId, locationId: location.id, productId: product.id, stockBaseQty: { gte: quantity } },
        data: { stockBaseQty: { decrement: quantity } },
      });
      if (changed.count !== 1) throw insufficientLocationStock(location, product, oldLocationStock, quantity);
    }
  }

  const globalChanged = await client.product.updateMany({
    where: {
      id: product.id,
      shopId,
      deletedAt: null,
      ...(!allowShortfall && { stockBaseQty: { gte: quantity } }),
    },
    data: { stockBaseQty: { decrement: quantity } },
  });
  if (globalChanged.count !== 1) {
    if (!allowShortfall) throw insufficientLocationStock(location, product, oldLocationStock, quantity);
    throw new AppError(`Product "${product.name}" is no longer available`, 409, "PRODUCT_NOT_AVAILABLE");
  }

  // Only once the base-unit movement is committed, so a rejected sale never moves
  // pack counts.
  await movePackagingStock(client, { shopId, product, packs, direction: "out" });

  const freshProduct = await client.product.findFirst({ where: { id: product.id, shopId }, select: { stockBaseQty: true } });
  const newLocationStock = location.isPrimary
    ? await getLocationQuantity(client, shopId, location, { ...product, stockBaseQty: freshProduct?.stockBaseQty ?? product.stockBaseQty - quantity })
    : Number((await client.locationStock.findUnique({
      where: { locationId_productId: { locationId: location.id, productId: product.id } },
      select: { stockBaseQty: true },
    }))?.stockBaseQty ?? 0);
  // The pre-update read may be stale when concurrent sales overlap. Reconstruct
  // the movement's own starting value from its committed result so ledger rows
  // always satisfy old + change = new without absorbing another sale's change.
  const movementOldStock = round2(newLocationStock + quantity);
  return {
    oldStock: movementOldStock,
    newStock: round2(newLocationStock),
    shortfallBaseQty: round2(Math.max(0, -newLocationStock)),
    globalStockBaseQty: round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - quantity),
  };
}

export async function incrementLocationInventory(client, { shopId, location, product, quantityBase, expectedGlobalStockBaseQty, productData = {}, packs = null }) {
  const quantity = round2(quantityBase);
  const oldLocationStock = await getLocationQuantity(client, shopId, location, product);
  const changed = await client.product.updateMany({
    where: { id: product.id, shopId, deletedAt: null, ...(expectedGlobalStockBaseQty !== undefined && { stockBaseQty: expectedGlobalStockBaseQty }) },
    data: { stockBaseQty: { increment: quantity }, ...productData },
  });
  if (changed.count !== 1) {
    if (expectedGlobalStockBaseQty !== undefined) throw new AppError("Stock changed while recording purchase. Please retry.", 409, "CONCURRENT_STOCK_MODIFICATION_RETRY");
    throw new AppError(`Product "${product.name}" is no longer available`, 409, "PRODUCT_NOT_AVAILABLE");
  }
  // Mirror of the decrement path: a cancelled or returned sale must put back the
  // same packs it took, or the counts drift a little further from reality on every
  // reversal until they are worthless.
  await movePackagingStock(client, { shopId, product, packs, direction: "in" });
  if (!location.isPrimary) {
    await client.locationStock.upsert({
      where: { locationId_productId: { locationId: location.id, productId: product.id } },
      create: { shopId, locationId: location.id, productId: product.id, stockBaseQty: quantity },
      update: { stockBaseQty: { increment: quantity } },
    });
  }
  return { oldStock: oldLocationStock, newStock: round2(oldLocationStock + quantity) };
}

export async function setLocationInventory(client, { shopId, location, product, newStockBaseQty }) {
  const requested = round2(newStockBaseQty);
  const oldLocationStock = await getLocationQuantity(client, shopId, location, product);
  const difference = round2(requested - oldLocationStock);
  const changed = await client.product.updateMany({
    where: { id: product.id, shopId, deletedAt: null, stockBaseQty: product.stockBaseQty },
    data: { stockBaseQty: { increment: difference } },
  });
  if (changed.count !== 1) throw new AppError("Stock changed while applying correction. Please retry.", 409, "CONCURRENT_STOCK_MODIFICATION_RETRY");
  if (!location.isPrimary) {
    await client.locationStock.upsert({
      where: { locationId_productId: { locationId: location.id, productId: product.id } },
      create: { shopId, locationId: location.id, productId: product.id, stockBaseQty: requested },
      update: { stockBaseQty: requested },
    });
  }
  return { oldStock: oldLocationStock, newStock: requested, difference };
}
