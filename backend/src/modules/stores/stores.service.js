import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { getPlanLimits } from "../feature-gates/featureGate.service.js";

function transferRef() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TRF-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

export async function ensurePrimaryLocation(shopId, client = db) {
  const existing = await client.storeLocation.findFirst({ where: { shopId, isPrimary: true } });
  if (existing) return existing;
  const shop = await client.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  try {
    return await client.storeLocation.create({
      data: {
        shopId,
        code: "MAIN",
        name: `${shop.name} - Main`,
        address: shop.address,
        city: shop.city,
        gstNumber: shop.gstNumber,
        phone: shop.phone,
        isPrimary: true,
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    return client.storeLocation.findFirst({ where: { shopId, isPrimary: true } });
  }
}

export async function listLocations(shopId) {
  await ensurePrimaryLocation(shopId);
  const [locations, limits] = await Promise.all([
    db.storeLocation.findMany({
      where: { shopId },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { stocks: true, outgoingTransfers: true, incomingTransfers: true } } },
    }),
    getPlanLimits(shopId),
  ]);
  return { locations, usage: { current: locations.filter((row) => row.active).length, maximum: limits.maxStores } };
}

export async function createLocation(shopId, data) {
  await ensurePrimaryLocation(shopId);
  const [activeCount, limits] = await Promise.all([
    db.storeLocation.count({ where: { shopId, active: true } }),
    getPlanLimits(shopId),
  ]);
  if (activeCount >= limits.maxStores) {
    const error = new AppError(`Your plan supports ${limits.maxStores} active store location${limits.maxStores === 1 ? "" : "s"}.`, 403, "STORE_LIMIT_REACHED");
    error.publicData = { usage: { current: activeCount, maximum: limits.maxStores } };
    throw error;
  }
  return db.storeLocation.create({ data: { shopId, ...data, isPrimary: false } });
}

export async function updateLocation(shopId, locationId, data) {
  const location = await db.storeLocation.findFirst({ where: { id: locationId, shopId } });
  if (!location) throw new AppError("Store location not found", 404, "STORE_LOCATION_NOT_FOUND");
  if (location.isPrimary && data.active === false) {
    throw new AppError("The primary location cannot be deactivated", 409, "PRIMARY_LOCATION_REQUIRED");
  }
  return db.storeLocation.update({ where: { id: location.id }, data });
}

async function inventorySnapshot(client, shopId, location) {
  const [products, secondary] = await Promise.all([
    client.product.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseUnit: true, displayUnit: true, stockBaseQty: true, lowStockThreshold: true },
    }),
    client.locationStock.findMany({ where: { shopId }, select: { locationId: true, productId: true, stockBaseQty: true, lowStockThreshold: true } }),
  ]);
  const rowsByKey = new Map(secondary.map((row) => [`${row.locationId}:${row.productId}`, row]));
  const allocated = new Map();
  for (const row of secondary) allocated.set(row.productId, (allocated.get(row.productId) ?? 0) + Number(row.stockBaseQty));

  return products.map((product) => {
    const explicit = rowsByKey.get(`${location.id}:${product.id}`);
    const stockBaseQty = location.isPrimary
      ? Number(product.stockBaseQty) - (allocated.get(product.id) ?? 0)
      : Number(explicit?.stockBaseQty ?? 0);
    const threshold = explicit?.lowStockThreshold ?? product.lowStockThreshold;
    return {
      ...product,
      stockBaseQty,
      lowStockThreshold: threshold,
      isLowStock: threshold > 0 && stockBaseQty <= threshold,
      allocationWarning: stockBaseQty < 0,
    };
  });
}

export async function getLocationInventory(shopId, locationId) {
  await ensurePrimaryLocation(shopId);
  const location = await db.storeLocation.findFirst({ where: { id: locationId, shopId } });
  if (!location) throw new AppError("Store location not found", 404, "STORE_LOCATION_NOT_FOUND");
  return { location, products: await inventorySnapshot(db, shopId, location) };
}

function normalizeItems(items) {
  const totals = new Map();
  for (const item of items) totals.set(item.productId, (totals.get(item.productId) ?? 0) + Number(item.quantityBaseQty));
  return [...totals].map(([productId, quantityBaseQty]) => ({ productId, quantityBaseQty }));
}

export async function createTransfer(shopId, data, userId) {
  if (data.fromLocationId === data.toLocationId) {
    throw new AppError("Source and destination locations must be different", 400, "SAME_TRANSFER_LOCATION");
  }
  const items = normalizeItems(data.items);
  return db.$transaction(async (tx) => {
    const locations = await tx.storeLocation.findMany({
      where: { shopId, id: { in: [data.fromLocationId, data.toLocationId] }, active: true },
    });
    if (locations.length !== 2) throw new AppError("An active source or destination location was not found", 404, "STORE_LOCATION_NOT_FOUND");
    const from = locations.find((row) => row.id === data.fromLocationId);
    const to = locations.find((row) => row.id === data.toLocationId);
    const sourceSnapshot = await inventorySnapshot(tx, shopId, from);
    const sourceById = new Map(sourceSnapshot.map((row) => [row.id, row]));

    for (const item of items) {
      const product = sourceById.get(item.productId);
      if (!product) throw new AppError("A transfer product was not found", 404, "PRODUCT_NOT_FOUND");
      if (product.stockBaseQty < item.quantityBaseQty) {
        const error = new AppError(`${product.name} has only ${product.stockBaseQty} ${product.baseUnit} at ${from.name}`, 409, "INSUFFICIENT_LOCATION_STOCK");
        error.publicData = { productId: product.id, availableBaseQty: product.stockBaseQty };
        throw error;
      }
    }

    for (const item of items) {
      if (!from.isPrimary) {
        const updated = await tx.locationStock.updateMany({
          where: { locationId: from.id, productId: item.productId, shopId, stockBaseQty: { gte: item.quantityBaseQty } },
          data: { stockBaseQty: { decrement: item.quantityBaseQty } },
        });
        if (updated.count !== 1) throw new AppError("Location stock changed; retry the transfer", 409, "CONCURRENT_LOCATION_STOCK_CHANGE");
      }
      if (!to.isPrimary) {
        await tx.locationStock.upsert({
          where: { locationId_productId: { locationId: to.id, productId: item.productId } },
          create: { shopId, locationId: to.id, productId: item.productId, stockBaseQty: item.quantityBaseQty },
          update: { stockBaseQty: { increment: item.quantityBaseQty } },
        });
      }
    }

    const products = new Map(sourceSnapshot.map((row) => [row.id, row]));
    return tx.stockTransfer.create({
      data: {
        shopId,
        referenceNo: transferRef(),
        fromLocationId: from.id,
        toLocationId: to.id,
        status: "completed",
        note: data.note || null,
        createdByUserId: userId || null,
        completedAt: new Date(),
        items: { create: items.map((item) => ({
          productId: item.productId,
          productName: products.get(item.productId).name,
          quantityBaseQty: item.quantityBaseQty,
          baseUnit: products.get(item.productId).baseUnit,
        })) },
      },
      include: { fromLocation: true, toLocation: true, items: true },
    });
  });
}

export async function listTransfers(shopId, { limit = 50 } = {}) {
  return db.stockTransfer.findMany({
    where: { shopId },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    include: { fromLocation: true, toLocation: true, items: true },
  });
}

