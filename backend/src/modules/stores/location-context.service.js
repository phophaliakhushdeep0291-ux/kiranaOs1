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

/**
 * Read one LocationStock row.
 *
 * Not findUnique on locationId_productId_sellingUnitId, because Prisma refuses a
 * null inside a compound unique key — "Argument `sellingUnitId` must not be null"
 * — and the product-level row IS the null case, which is nearly every row there
 * is. findFirst has no such restriction, and the unique indexes still guarantee
 * there is at most one match.
 */
export async function findLocationStockRow(client, { shopId, locationId, productId, sellingUnitId = null }) {
  return client.locationStock.findFirst({
    where: { shopId, locationId, productId, sellingUnitId },
    select: { id: true, stockBaseQty: true },
  });
}

/**
 * Add to (or set) one LocationStock row, creating it if it does not exist yet.
 *
 * The manual update-then-create stands in for upsert for the same reason as
 * above. Two racing creates lose to the unique index rather than duplicating the
 * row, which is the same outcome upsert gave.
 */
export async function writeLocationStockRow(client, { shopId, locationId, productId, sellingUnitId = null, delta = null, absolute = null }) {
  const data = absolute !== null ? { stockBaseQty: absolute } : { stockBaseQty: { increment: delta } };
  const changed = await client.locationStock.updateMany({
    where: { shopId, locationId, productId, sellingUnitId },
    data,
  });
  if (changed.count > 0) return;
  await client.locationStock.create({
    data: { shopId, locationId, productId, sellingUnitId, stockBaseQty: absolute !== null ? absolute : delta },
  });
}

async function allocatedSecondaryQty(client, shopId, productId) {
  const rows = await client.locationStock.findMany({
    // Product-level rows only. Variant rows live in the same table but count in
    // their own unit (packets, pairs), not base units — summing them into a
    // base-unit total would be adding metres to kilograms, and would silently
    // shrink the primary location's stock by whatever the branches hold per size.
    where: { shopId, productId, sellingUnitId: null },
    select: { stockBaseQty: true },
  });
  return round2(rows.reduce((sum, row) => sum + Number(row.stockBaseQty || 0), 0));
}

/**
 * What one variant holds at one location, in that unit's own counts.
 *
 * Mirrors getLocationQuantity exactly: the primary location keeps no row, so its
 * share is the unit's global onHandQty minus everything the branches hold.
 */
export async function getVariantLocationQuantity(client, shopId, location, product, sellingUnitId) {
  if (!location.isPrimary) {
    const row = await findLocationStockRow(client, { shopId, locationId: location.id, productId: product.id, sellingUnitId });
    return round2(row?.stockBaseQty ?? 0);
  }
  const [unit, branchRows] = await Promise.all([
    client.productSellingUnit.findFirst({ where: { id: sellingUnitId, shopId, productId: product.id }, select: { onHandQty: true } }),
    client.locationStock.findMany({ where: { shopId, productId: product.id, sellingUnitId }, select: { stockBaseQty: true } }),
  ]);
  const atBranches = branchRows.reduce((sum, row) => sum + Number(row.stockBaseQty || 0), 0);
  return round2(Number(unit?.onHandQty ?? 0) - atBranches);
}

export async function getLocationQuantity(client, shopId, location, product) {
  if (!location.isPrimary) {
    const row = await findLocationStockRow(client, { shopId, locationId: location.id, productId: product.id });
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
async function movePackagingStock(client, { shopId, location = null, product, packs, direction, operation = "This operation" }) {
  if (product?.packagingMode !== "per_pack") return;

  // Fail loudly rather than drift. Several stock paths (purchase-order receipt,
  // stock counts, absolute stock edits, supplier returns) still move base units
  // without knowing which pack, and silently letting them through would move
  // the pooled total while the per-size counts stood still — the counts would decay
  // into confident-looking fiction, which is the whole failure this design exists
  // to avoid. Refusing is recoverable; silent drift is not.
  //
  // Pooled products never reach this line, so nothing that works today can break.
  if (!packs?.size) {
    throw new AppError(
      `${operation} does not yet support per-packaging stock for "${product.name}". Record it as a sale, purchase or return, or switch the product to a single shared stock pool.`,
      400,
      "PACKAGING_STOCK_PATH_UNSUPPORTED",
    );
  }
  for (const { sellingUnit, qty } of packs.values()) {
    const amount = round2(qty);
    if (!(amount > 0)) continue;
    const delta = direction === "out" ? { decrement: amount } : { increment: amount };

    // The global count for this size, which every existing report reads.
    await client.productSellingUnit.updateMany({
      where: { id: sellingUnit.id, shopId, productId: product.id },
      data: { onHandQty: delta },
    });

    // ...and where those units physically are, so a two-branch shop can answer
    // "which counter has the L-Blue left?" rather than only "we own four".
    //
    // The primary location deliberately keeps no row, exactly as base units work:
    // its share is the global onHandQty minus everything the branches hold. That
    // way one number stays authoritative and the two can never disagree.
    //
    // NOTE the column: LocationStock.stockBaseQty holds BASE units on a
    // product-level row but this unit's OWN counts on a variant row — 4 pairs, not
    // 4000 g. It has to, because it is subtracted from onHandQty, which is itself
    // in the unit's own counts precisely so "down to 4 of the 500 g packs" needs
    // no conversion. Never sum the two kinds of row together.
    if (location && !location.isPrimary) {
      await writeLocationStockRow(client, {
        shopId, locationId: location.id, productId: product.id, sellingUnitId: sellingUnit.id,
        delta: direction === "out" ? -amount : amount,
      });
    }
  }
}

export async function decrementLocationInventory(client, { shopId, location, product, quantityBase, allowShortfall = false, packs = null }) {
  const quantity = round2(quantityBase);
  const oldLocationStock = await getLocationQuantity(client, shopId, location, product);
  if (!allowShortfall && oldLocationStock < quantity) throw insufficientLocationStock(location, product, oldLocationStock, quantity);

  if (!location.isPrimary) {
    if (allowShortfall) {
      await writeLocationStockRow(client, { shopId, locationId: location.id, productId: product.id, delta: -quantity });
    } else {
      const changed = await client.locationStock.updateMany({
        // sellingUnitId: null is load-bearing, not decoration. This table now holds
        // a variant row per size beside the product-level row, so without it a
        // two-size product matches three rows: all three get decremented and then
        // the count !== 1 check below rejects the sale it has already applied.
        where: { shopId, locationId: location.id, productId: product.id, sellingUnitId: null, stockBaseQty: { gte: quantity } },
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
  await movePackagingStock(client, { shopId, location, product, packs, direction: "out" });

  const freshProduct = await client.product.findFirst({ where: { id: product.id, shopId }, select: { stockBaseQty: true } });
  const newLocationStock = location.isPrimary
    ? await getLocationQuantity(client, shopId, location, { ...product, stockBaseQty: freshProduct?.stockBaseQty ?? product.stockBaseQty - quantity })
    : Number((await findLocationStockRow(client, { shopId, locationId: location.id, productId: product.id }))?.stockBaseQty ?? 0);
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
  await movePackagingStock(client, { shopId, location, product, packs, direction: "in" });
  if (!location.isPrimary) {
    await writeLocationStockRow(client, { shopId, locationId: location.id, productId: product.id, delta: quantity });
  }
  return { oldStock: oldLocationStock, newStock: round2(oldLocationStock + quantity) };
}

export async function setLocationInventory(client, { shopId, location, product, newStockBaseQty }) {
  // Declaring an absolute total is genuinely ambiguous for a per_pack product:
  // "there are 6720 g of Maggi" says nothing about how many are boxes and how many
  // are packets, and any split invented here would be a guess written into the
  // shopkeeper's reorder data. Counting per size needs its own input, so refuse
  // until it exists rather than silently desynchronise the two numbers.
  if (product?.packagingMode === "per_pack") {
    throw new AppError(
      `"${product.name}" is counted per packaging, so its stock cannot be set as one total. Count each pack size instead.`,
      400,
      "PACKAGING_STOCK_PATH_UNSUPPORTED",
    );
  }
  const requested = round2(newStockBaseQty);
  const oldLocationStock = await getLocationQuantity(client, shopId, location, product);
  const difference = round2(requested - oldLocationStock);
  const changed = await client.product.updateMany({
    where: { id: product.id, shopId, deletedAt: null, stockBaseQty: product.stockBaseQty },
    data: { stockBaseQty: { increment: difference } },
  });
  if (changed.count !== 1) throw new AppError("Stock changed while applying correction. Please retry.", 409, "CONCURRENT_STOCK_MODIFICATION_RETRY");
  if (!location.isPrimary) {
    await writeLocationStockRow(client, { shopId, locationId: location.id, productId: product.id, absolute: requested });
  }
  return { oldStock: oldLocationStock, newStock: requested, difference };
}
