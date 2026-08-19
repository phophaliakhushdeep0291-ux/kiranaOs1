import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { round2 } from "../../utils/money.js";
import { createAuditLog } from "../audit/audit.service.js";
import { getLocationQuantity, getVariantLocationQuantity } from "../stores/location-context.service.js";

const BIN_KINDS = new Set(["pick", "bulk", "staging"]);

/**
 * Bins say WHERE inside a branch stock sits. They never say HOW MUCH the branch
 * owns — LocationStock does, and for the primary branch that is the product total
 * minus every branch allocation. Everything here is written so that no bin
 * operation can change a branch's quantity:
 *
 *   - the only quantity mutation is movePlacement, which subtracts from one place
 *     and adds the same amount to another inside ONE location, netting to zero
 *   - "unplaced" is derived (location stock minus placements), never stored, so it
 *     cannot drift out of agreement with the stock it is derived from
 *
 * Placements are maintained by whoever puts stock away, and selling does not walk
 * the bin map (wiring bins into the sale path would force every sale, transfer,
 * count and per-pack route to know about bins, and the two ledgers would diverge
 * the first time one path forgot). So after a day of selling, placements can
 * exceed what the branch still holds. That is a real, expected condition rather
 * than corruption, so it is reported as overPlacedBaseQty and cleared with an
 * explicit reconcile, which is how cycle counting works on a real shelf.
 */
export function summarisePlacements(locationStockBaseQty, placements) {
  const placedBaseQty = round2(placements.reduce((sum, row) => sum + Number(row.stockBaseQty || 0), 0));
  const stock = round2(Number(locationStockBaseQty) || 0);
  return {
    locationStockBaseQty: stock,
    placedBaseQty,
    // Clamped rather than allowed negative: a negative "unplaced" is not a
    // quantity anyone can pick, and the overage is reported separately so the
    // condition stays visible instead of hiding inside a sign.
    unplacedBaseQty: round2(Math.max(0, stock - placedBaseQty)),
    overPlacedBaseQty: round2(Math.max(0, placedBaseQty - stock)),
    reconciled: Math.abs(placedBaseQty - stock) < 0.005 || placedBaseQty <= stock,
  };
}

async function loadLocation(shopId, locationId) {
  const location = await db.storeLocation.findFirst({ where: { id: locationId, shopId } });
  if (!location) throw new AppError("Location not found", 404, "LOCATION_NOT_FOUND");
  return location;
}

async function loadProduct(shopId, productId) {
  const product = await db.product.findFirst({ where: { id: productId, shopId, deletedAt: null } });
  if (!product) throw new AppError("Product not found", 404, "PRODUCT_NOT_FOUND");
  return product;
}

async function locationQuantityFor(client, shopId, location, product, sellingUnitId) {
  return sellingUnitId
    ? getVariantLocationQuantity(client, shopId, location, product, sellingUnitId)
    : getLocationQuantity(client, shopId, location, product);
}

export async function listBins(shopId, locationId) {
  await loadLocation(shopId, locationId);
  const bins = await db.storageBin.findMany({
    where: { shopId, locationId },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }, { code: "asc" }],
    include: { _count: { select: { placements: true } } },
  });
  return bins.map(({ _count, ...bin }) => ({ ...bin, placementCount: _count.placements }));
}

export async function createBin(shopId, input, actor = {}, req = null) {
  const location = await loadLocation(shopId, input.locationId);
  const code = String(input.code || "").trim().toUpperCase();
  if (!code) throw new AppError("Bin code is required", 422, "BIN_CODE_REQUIRED");
  if (input.kind && !BIN_KINDS.has(input.kind)) throw new AppError("Unknown bin kind", 422, "BIN_KIND_INVALID");

  const existing = await db.storageBin.findFirst({ where: { locationId: location.id, code } });
  if (existing) throw new AppError(`Bin ${code} already exists at ${location.name}`, 409, "BIN_CODE_TAKEN");

  const bin = await db.storageBin.create({
    data: {
      shopId,
      locationId: location.id,
      code,
      name: String(input.name || code).trim(),
      zone: input.zone ? String(input.zone).trim() : null,
      kind: input.kind || "pick",
      sortOrder: Number.isFinite(Number(input.sortOrder)) ? Number(input.sortOrder) : 0,
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "inventory", action: "STORAGE_BIN_CREATED",
    entityType: "StorageBin", entityId: bin.id, after: bin, req,
  });
  return bin;
}

export async function updateBin(shopId, binId, input, actor = {}, req = null) {
  const bin = await db.storageBin.findFirst({ where: { id: binId, shopId } });
  if (!bin) throw new AppError("Bin not found", 404, "BIN_NOT_FOUND");
  if (input.kind && !BIN_KINDS.has(input.kind)) throw new AppError("Unknown bin kind", 422, "BIN_KIND_INVALID");

  // Deactivating a bin that still holds stock would strand it: the placement stays
  // on the books but no put-away or pick list offers the bin any more, so the
  // quantity becomes invisible without anything having moved.
  if (input.active === false && bin.active) {
    const held = await db.binPlacement.aggregate({ where: { binId: bin.id }, _sum: { stockBaseQty: true } });
    if (Number(held._sum.stockBaseQty || 0) > 0) {
      throw new AppError(`Move the stock out of ${bin.code} before deactivating it`, 409, "BIN_NOT_EMPTY");
    }
  }

  const updated = await db.storageBin.update({
    where: { id: bin.id },
    data: {
      ...(input.name !== undefined && { name: String(input.name).trim() }),
      ...(input.zone !== undefined && { zone: input.zone ? String(input.zone).trim() : null }),
      ...(input.kind !== undefined && { kind: input.kind }),
      ...(input.sortOrder !== undefined && { sortOrder: Number(input.sortOrder) || 0 }),
      ...(input.active !== undefined && { active: Boolean(input.active) }),
    },
  });
  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "inventory", action: "STORAGE_BIN_UPDATED",
    entityType: "StorageBin", entityId: bin.id, before: bin, after: updated, req,
  });
  return updated;
}

export async function getBinMap(shopId, locationId, query = {}) {
  const location = await loadLocation(shopId, locationId);
  const product = await loadProduct(shopId, query.productId);
  const sellingUnitId = query.sellingUnitId || null;

  const [bins, placements, locationStockBaseQty] = await Promise.all([
    db.storageBin.findMany({ where: { shopId, locationId: location.id, active: true }, orderBy: [{ sortOrder: "asc" }, { code: "asc" }] }),
    db.binPlacement.findMany({ where: { shopId, productId: product.id, sellingUnitId, bin: { locationId: location.id } }, include: { bin: true } }),
    locationQuantityFor(db, shopId, location, product, sellingUnitId),
  ]);

  const placementByBin = new Map(placements.map((row) => [row.binId, row]));
  return {
    location: { id: location.id, code: location.code, name: location.name, isPrimary: location.isPrimary },
    product: { id: product.id, name: product.name, baseUnit: product.baseUnit },
    sellingUnitId,
    ...summarisePlacements(locationStockBaseQty, placements),
    bins: bins.map((bin) => ({
      binId: bin.id,
      code: bin.code,
      name: bin.name,
      zone: bin.zone,
      kind: bin.kind,
      stockBaseQty: round2(Number(placementByBin.get(bin.id)?.stockBaseQty || 0)),
    })),
  };
}

/**
 * The one operation that changes a placement quantity. A null bin id on either
 * side means "unplaced" — the part of the branch's stock nobody has put away yet
 * — so putting away, moving between bins and pulling back to the floor are all
 * the same net-zero transfer, and none of them touch LocationStock.
 */
export async function movePlacement(shopId, input, actor = {}, req = null) {
  const quantityBaseQty = round2(Number(input.quantityBaseQty));
  if (!(quantityBaseQty > 0)) throw new AppError("Move quantity must be greater than zero", 422, "BIN_MOVE_QTY_INVALID");

  const fromBinId = input.fromBinId || null;
  const toBinId = input.toBinId || null;
  if (!fromBinId && !toBinId) throw new AppError("Choose a source or destination bin", 422, "BIN_MOVE_ENDPOINT_REQUIRED");
  if (fromBinId && fromBinId === toBinId) throw new AppError("Source and destination bins are the same", 422, "BIN_MOVE_SAME_BIN");

  const location = await loadLocation(shopId, input.locationId);
  const product = await loadProduct(shopId, input.productId);
  const sellingUnitId = input.sellingUnitId || null;

  // A move across locations would change what each branch holds, which is a
  // transfer with its own document, tax treatment and in-transit reservation — not
  // a put-away. Rejecting it here is what keeps the net-zero guarantee true.
  const endpoints = await db.storageBin.findMany({ where: { id: { in: [fromBinId, toBinId].filter(Boolean) }, shopId } });
  for (const bin of endpoints) {
    if (bin.locationId !== location.id) throw new AppError(`Bin ${bin.code} belongs to another location`, 422, "BIN_LOCATION_MISMATCH");
  }
  if (endpoints.length !== [fromBinId, toBinId].filter(Boolean).length) throw new AppError("Bin not found", 404, "BIN_NOT_FOUND");
  const destination = toBinId ? endpoints.find((bin) => bin.id === toBinId) : null;
  if (destination && !destination.active) throw new AppError(`Bin ${destination.code} is inactive`, 422, "BIN_INACTIVE");

  const result = await db.$transaction(async (tx) => {
    const placements = await tx.binPlacement.findMany({ where: { shopId, productId: product.id, sellingUnitId, bin: { locationId: location.id } } });
    const locationStockBaseQty = await locationQuantityFor(tx, shopId, location, product, sellingUnitId);
    const summary = summarisePlacements(locationStockBaseQty, placements);

    if (fromBinId) {
      const source = placements.find((row) => row.binId === fromBinId);
      const available = round2(Number(source?.stockBaseQty || 0));
      if (available < quantityBaseQty) {
        const error = new AppError(`That bin holds ${available} ${product.baseUnit}, less than the ${quantityBaseQty} being moved`, 409, "BIN_INSUFFICIENT_PLACEMENT");
        error.publicData = { binId: fromBinId, availableBaseQty: available, requestedBaseQty: quantityBaseQty };
        throw error;
      }
      await tx.binPlacement.update({ where: { id: source.id }, data: { stockBaseQty: round2(available - quantityBaseQty) } });
    } else if (summary.unplacedBaseQty < quantityBaseQty) {
      // Putting away more than the branch actually has left unplaced would make the
      // bin map claim stock the branch does not hold.
      const error = new AppError(`Only ${summary.unplacedBaseQty} ${product.baseUnit} is unplaced at ${location.name}`, 409, "BIN_INSUFFICIENT_UNPLACED");
      error.publicData = { availableBaseQty: summary.unplacedBaseQty, requestedBaseQty: quantityBaseQty };
      throw error;
    }

    if (toBinId) {
      const existing = placements.find((row) => row.binId === toBinId);
      if (existing) {
        await tx.binPlacement.update({ where: { id: existing.id }, data: { stockBaseQty: round2(Number(existing.stockBaseQty) + quantityBaseQty) } });
      } else {
        await tx.binPlacement.create({ data: { shopId, binId: toBinId, productId: product.id, sellingUnitId, stockBaseQty: quantityBaseQty } });
      }
    }

    const after = await tx.binPlacement.findMany({ where: { shopId, productId: product.id, sellingUnitId, bin: { locationId: location.id } } });
    const afterStock = await locationQuantityFor(tx, shopId, location, product, sellingUnitId);
    // The guarantee, asserted rather than assumed: a put-away must never change
    // what the branch owns. If this ever fires, the move is rolled back.
    if (Math.abs(round2(afterStock) - round2(locationStockBaseQty)) >= 0.005) {
      throw new AppError("Bin move changed branch stock and was rolled back", 500, "BIN_MOVE_CHANGED_STOCK");
    }
    return summarisePlacements(afterStock, after);
  });

  await createAuditLog({
    shopId, userId: actor.userId ?? null, module: "inventory", action: "BIN_PLACEMENT_MOVED",
    entityType: "BinPlacement", entityId: `${location.id}:${product.id}`,
    after: { locationId: location.id, productId: product.id, sellingUnitId, fromBinId, toBinId, quantityBaseQty }, req,
  });
  return { ...result, locationId: location.id, productId: product.id, sellingUnitId };
}

/**
 * Selling does not walk the bin map, so placements drift above real stock as the
 * day goes on. This trims them back proportionally, largest bin first, and is the
 * only other way a placement quantity changes — again without touching stock.
 */
export async function reconcilePlacements(shopId, input, actor = {}, req = null) {
  const location = await loadLocation(shopId, input.locationId);
  const product = await loadProduct(shopId, input.productId);
  const sellingUnitId = input.sellingUnitId || null;

  const result = await db.$transaction(async (tx) => {
    const placements = await tx.binPlacement.findMany({
      where: { shopId, productId: product.id, sellingUnitId, bin: { locationId: location.id } },
      orderBy: { stockBaseQty: "desc" },
    });
    const locationStockBaseQty = await locationQuantityFor(tx, shopId, location, product, sellingUnitId);
    const before = summarisePlacements(locationStockBaseQty, placements);
    if (before.overPlacedBaseQty <= 0) return { ...before, trimmedBaseQty: 0 };

    let remaining = before.overPlacedBaseQty;
    for (const placement of placements) {
      if (remaining <= 0) break;
      const held = round2(Number(placement.stockBaseQty || 0));
      const take = round2(Math.min(held, remaining));
      if (take <= 0) continue;
      await tx.binPlacement.update({ where: { id: placement.id }, data: { stockBaseQty: round2(held - take) } });
      remaining = round2(remaining - take);
    }
    const after = await tx.binPlacement.findMany({ where: { shopId, productId: product.id, sellingUnitId, bin: { locationId: location.id } } });
    return { ...summarisePlacements(locationStockBaseQty, after), trimmedBaseQty: before.overPlacedBaseQty };
  });

  if (result.trimmedBaseQty > 0) {
    await createAuditLog({
      shopId, userId: actor.userId ?? null, module: "inventory", action: "BIN_PLACEMENTS_RECONCILED",
      entityType: "BinPlacement", entityId: `${location.id}:${product.id}`,
      after: { locationId: location.id, productId: product.id, sellingUnitId, trimmedBaseQty: result.trimmedBaseQty }, req,
    });
  }
  return result;
}
