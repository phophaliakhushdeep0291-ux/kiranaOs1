import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import {
  getProductPermanentDeleteBlockReason,
  hasActiveDuplicateProductName,
  normalizeProductName,
} from "../../utils/productRecycleRules.js";
import { moneyShadows } from "../../utils/money.js";

export async function listProducts(shopId, { category, search, lowStock } = {}) {
  const where = {
    shopId,
    deletedAt: null,
    ...(category && { category }),
    ...(search && {
      OR: [
        { name: { contains: search } },
        { aliasesJson: { contains: search } },
      ],
    }),
  };

  const products = await db.product.findMany({
    where,
    orderBy: { name: "asc" },
  });

  // Parse aliasesJson back to array for response
  const parsed = products.map(deserializeProduct);

  if (lowStock) {
    return parsed.filter(
      (p) => p.lowStockThreshold > 0 && p.stockBaseQty <= p.lowStockThreshold
    );
  }

  return parsed;
}

export async function getProduct(shopId, id) {
  const product = await db.product.findFirst({
    where: { id, shopId, deletedAt: null },
  });
  if (!product) throw new AppError("Product not found", 404);
  return deserializeProduct(product);
}

export async function createProduct(shopId, data) {
  await assertNoActiveProductNameConflict(shopId, data.name);

  const { aliases, ...rest } = data;
  const product = await db.product.create({
    data: {
      ...rest,
      ...moneyShadows({
        costPerRateUnit: rest.costPerRateUnit,
        minPricePerRateUnit: rest.minPricePerRateUnit,
        defaultPricePerRateUnit: rest.defaultPricePerRateUnit,
      }),
      shopId,
      aliasesJson: JSON.stringify(aliases ?? []),
    },
  });
  return deserializeProduct(product);
}

export async function updateProduct(shopId, id, data) {
  await getProduct(shopId, id); // ensures it exists and belongs to shop
  if (data.name) await assertNoActiveProductNameConflict(shopId, data.name, id);

  const { aliases, ...rest } = data;
  const updateData = {
    ...rest,
    ...moneyShadows({
      costPerRateUnit: rest.costPerRateUnit,
      minPricePerRateUnit: rest.minPricePerRateUnit,
      defaultPricePerRateUnit: rest.defaultPricePerRateUnit,
    }),
  };
  if (aliases !== undefined) updateData.aliasesJson = JSON.stringify(aliases);

  const updated = await db.product.update({
    where: { id },
    data: updateData,
  });
  return deserializeProduct(updated);
}

export async function softDeleteProduct(shopId, id) {
  await getProduct(shopId, id);

  const deleted = await db.product.update({
    where: { id },
    data: { deletedAt: new Date() },
  });

  return deserializeProduct(deleted);
}

export async function listDeletedProducts(shopId, { search } = {}) {
  const products = await db.product.findMany({
    where: {
      shopId,
      deletedAt: { not: null },
      ...(search && {
        OR: [
          { name: { contains: search } },
          { aliasesJson: { contains: search } },
        ],
      }),
    },
    orderBy: { deletedAt: "desc" },
  });

  return products.map(deserializeProduct);
}

export async function restoreDeletedProduct(shopId, id) {
  const deletedProduct = await getDeletedProduct(shopId, id);

  const activeProducts = await db.product.findMany({
    where: { shopId, deletedAt: null },
    select: { id: true, name: true, category: true, deletedAt: true },
  });

  if (hasActiveDuplicateProductName(deletedProduct, activeProducts)) {
    throw new AppError(
      `Cannot restore product because an active product named "${deletedProduct.name}" already exists`,
      409
    );
  }

  const restored = await db.product.update({
    where: { id },
    data: { deletedAt: null },
  });

  return deserializeProduct(restored);
}

export async function permanentlyDeleteProduct(shopId, id) {
  const deletedProduct = await getDeletedProduct(shopId, id);
  const blockReason = await getPermanentDeleteBlockReason(id);

  if (blockReason) {
    throw new AppError(
      `${blockReason}. Keep this product in recycle bin to preserve audit/history records.`,
      409
    );
  }

  await db.$transaction(async (tx) => {
    // Bill items keep their own name/rate/cost snapshots, so the product link can
    // safely be removed before hard-deleting the product master record.
    await tx.billItem.updateMany({
      where: { productId: id },
      data: { productId: null },
    });

    await tx.product.delete({
      where: { id: deletedProduct.id },
    });
  });

  return {
    id: deletedProduct.id,
    name: deletedProduct.name,
    category: deletedProduct.category,
    deletedAt: deletedProduct.deletedAt,
  };
}

export async function emptyProductRecycleBin(shopId) {
  const deletedProducts = await db.product.findMany({
    where: { shopId, deletedAt: { not: null } },
    select: { id: true, name: true, category: true, deletedAt: true },
    orderBy: { deletedAt: "desc" },
  });

  const deleted = [];
  const blocked = [];

  await db.$transaction(async (tx) => {
    for (const product of deletedProducts) {
      const blockReason = await getPermanentDeleteBlockReason(product.id, tx);

      if (blockReason) {
        blocked.push({ id: product.id, name: product.name, category: product.category, reason: blockReason });
        continue;
      }

      await tx.billItem.updateMany({
        where: { productId: product.id },
        data: { productId: null },
      });

      await tx.product.delete({ where: { id: product.id } });
      deleted.push({ id: product.id, name: product.name, category: product.category, deletedAt: product.deletedAt });
    }
  });

  return {
    deletedCount: deleted.length,
    blockedCount: blocked.length,
    deleted,
    blocked,
  };
}

async function assertNoActiveProductNameConflict(shopId, name, excludeId = null) {
  const normalizedName = normalizeProductName(name);
  if (!normalizedName) return;

  const activeProducts = await db.product.findMany({
    where: { shopId, deletedAt: null, ...(excludeId && { NOT: { id: excludeId } }) },
    select: { id: true, name: true },
  });

  const duplicate = activeProducts.find((product) => normalizeProductName(product.name) === normalizedName);
  if (duplicate) {
    const err = new AppError(`Product named "${name}" already exists`, 409);
    err.code = "PRODUCT_NAME_DUPLICATE";
    throw err;
  }
}

async function getDeletedProduct(shopId, id) {
  const product = await db.product.findFirst({
    where: { id, shopId, deletedAt: { not: null } },
  });

  if (!product) throw new AppError("Deleted product not found in recycle bin", 404);
  return product;
}

async function getPermanentDeleteBlockReason(productId, client = db) {
  const stockLedgerCount = await client.stockLedger.count({ where: { productId } });
  const purchaseHistoryCount = await client.purchaseHistory.count({ where: { productId } });

  return getProductPermanentDeleteBlockReason({
    stockLedgerCount,
    purchaseHistoryCount,
  });
}

// ── Internal helper ───────────────────────────────────────────
export function deserializeProduct(p) {
  return {
    ...p,
    aliases: JSON.parse(p.aliasesJson ?? "[]"),
  };
}
