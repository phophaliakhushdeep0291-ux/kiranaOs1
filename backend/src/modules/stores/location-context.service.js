import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { ensurePrimaryLocation } from "./stores.service.js";

export function requestLocationId(req) {
  const values = [req?.body?.locationId, req?.body?.location_id, req?.query?.locationId, req?.headers?.["x-location-id"]];
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

export async function decrementLocationInventory(client, { shopId, location, product, quantityBase, allowShortfall = false }) {
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

  const freshProduct = await client.product.findFirst({ where: { id: product.id, shopId }, select: { stockBaseQty: true } });
  const newLocationStock = location.isPrimary
    ? await getLocationQuantity(client, shopId, location, { ...product, stockBaseQty: freshProduct?.stockBaseQty ?? product.stockBaseQty - quantity })
    : round2(oldLocationStock - quantity);
  return {
    oldStock: oldLocationStock,
    newStock: newLocationStock,
    shortfallBaseQty: round2(Math.max(0, -newLocationStock)),
    globalStockBaseQty: round2(freshProduct?.stockBaseQty ?? product.stockBaseQty - quantity),
  };
}

export async function incrementLocationInventory(client, { shopId, location, product, quantityBase, expectedGlobalStockBaseQty, productData = {} }) {
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
