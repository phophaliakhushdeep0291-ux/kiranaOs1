import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyShadows, multiplyMoney, round2, sumMoney } from "../../utils/money.js";
import { validateGstin, validateHsn } from "../../utils/gst.js";
import { getPlanLimits } from "../feature-gates/featureGate.service.js";
import { accessibleLocationIds, assertLocationCapability } from "./location-access.service.js";
// Cyclic with location-context (it imports ensurePrimaryLocation from here), which
// ESM resolves because both sides are hoisted function declarations used only at
// call time. Kept as an import rather than a local copy on purpose: the
// primary-share rule must have exactly one implementation, or the two drift.
import { getVariantLocationQuantity, writeLocationStockRow } from "./location-context.service.js";
import { createAuditLog } from "../audit/audit.service.js";
import { stockLedgerProvenance } from "../inventory/stock-ledger-provenance.js";

async function writeRequiredStoreAudit(entry, client) {
  const audit = await createAuditLog({ ...entry, client });
  if (!audit) {
    throw new AppError(
      "Store operation was not saved because its audit record could not be stored",
      503,
      "STORE_AUDIT_WRITE_FAILED",
    );
  }
  return audit;
}

function normalizeActor(actor = {}) {
  return { userId: actor.userId ?? null, deviceId: actor.deviceId ?? undefined, req: actor.req ?? null };
}

function locationAuditSnapshot(location) {
  if (!location) return null;
  return {
    code: location.code,
    name: location.name,
    address: location.address,
    city: location.city,
    gstNumber: location.gstNumber,
    gstStateCode: location.gstStateCode,
    gstLegalName: location.gstLegalName,
    gstTradeName: location.gstTradeName,
    gstRegistrationType: location.gstRegistrationType,
    phone: location.phone,
    active: location.active,
    isPrimary: location.isPrimary,
  };
}

function transferAuditMetadata(transfer) {
  return {
    referenceNo: transfer.referenceNo,
    fromLocationId: transfer.fromLocationId,
    toLocationId: transfer.toLocationId,
    itemCount: transfer.items?.length ?? 0,
    gstTreatment: transfer.gstTreatment,
    documentType: transfer.documentType,
    documentNumber: transfer.documentNumber,
    taxableValuePaise: transfer.taxableValuePaise?.toString?.() ?? null,
    taxTotalPaise: transfer.taxTotalPaise?.toString?.() ?? null,
    consignmentValuePaise: transfer.consignmentValuePaise?.toString?.() ?? null,
    eWayReviewRequired: transfer.eWayReviewRequired,
    legalSubmissionStatus: transfer.eWayReviewStatus === "external_reference_recorded" ? "external_reference_recorded_not_verified" : "not_submitted",
    fulfillmentMode: transfer.fulfillmentMode,
    status: transfer.status,
    trackingNumber: transfer.trackingNumber,
  };
}

function transferRef() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `TRF-${day}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

async function writeTransferStockMovement(tx, {
  shopId,
  transferId,
  transferItemId,
  locationId,
  productId,
  productName,
  sellingUnitId = null,
  sellingUnitQty = null,
  action,
  changeBaseQty,
  oldStockBaseQty,
  newStockBaseQty,
  actor,
  phase,
  note,
}) {
  return tx.stockLedger.create({
    data: {
      shopId,
      locationId,
      productId,
      productName,
      sellingUnitId,
      sellingUnitQty,
      action,
      changeBaseQty,
      oldStockBaseQty,
      newStockBaseQty,
      ...stockLedgerProvenance({ userId: actor?.userId }),
      idempotencyKey: `stock-transfer:${transferId}:${phase}:${transferItemId}`,
      sourceType: "stock_transfer",
      sourceId: transferId,
      note,
    },
  });
}

function owns(object, key) {
  return Object.prototype.hasOwnProperty.call(object ?? {}, key);
}

function registrationSnapshot(location) {
  const validation = validateGstin(location?.gstNumber);
  if (location?.gstNumber && !validation.valid) {
    const error = new AppError(`${location.name}: ${validation.reason}`, 422, "INVALID_LOCATION_GSTIN");
    error.publicData = { locationId: location.id, locationName: location.name };
    throw error;
  }
  return validation.valid
    ? { gstin: validation.normalized, stateCode: validation.stateCode, registered: true }
    : { gstin: null, stateCode: null, registered: false };
}

function normalizeLocationRegistration(data, shop, { inheritWhenOmitted = false, existingLocation = null } = {}) {
  const explicitGstin = owns(data, "gstNumber");
  const rawGstin = explicitGstin ? data.gstNumber : inheritWhenOmitted ? shop?.gstNumber : undefined;
  if (rawGstin) {
    const validation = validateGstin(rawGstin);
    if (!validation.valid) throw new AppError(validation.reason, 422, "INVALID_LOCATION_GSTIN");
    if (data.gstRegistrationType === "unregistered") {
      throw new AppError("A location with a GSTIN cannot be marked unregistered", 422, "LOCATION_REGISTRATION_CONFLICT");
    }
    return {
      ...data,
      gstNumber: validation.normalized,
      gstStateCode: validation.stateCode,
      gstLegalName: data.gstLegalName || existingLocation?.gstLegalName || shop?.name || null,
      gstTradeName: data.gstTradeName || data.name || existingLocation?.gstTradeName || existingLocation?.name || null,
      gstRegistrationType: data.gstRegistrationType || existingLocation?.gstRegistrationType || "regular",
    };
  }
  if (rawGstin === null || (explicitGstin && rawGstin === "")) {
    if (data.gstRegistrationType && !["unregistered", "other"].includes(data.gstRegistrationType)) {
      throw new AppError("A registered location type requires a valid GSTIN", 422, "LOCATION_REGISTRATION_CONFLICT");
    }
    return { ...data, gstNumber: null, gstStateCode: null, gstRegistrationType: data.gstRegistrationType || "unregistered" };
  }
  return data;
}

function locationWithRegistrationStatus(location) {
  const validation = validateGstin(location.gstNumber);
  return {
    ...location,
    taxRegistration: {
      status: validation.valid ? "format_valid" : location.gstNumber ? "invalid" : "unregistered",
      formatValid: validation.valid,
      gstin: validation.valid ? validation.normalized : location.gstNumber || null,
      stateCode: validation.valid ? validation.stateCode : location.gstStateCode || null,
      notice: validation.valid
        ? "GSTIN format and checksum validated locally; GST portal status is not verified."
        : location.gstNumber
          ? validation.reason
          : "No GSTIN is assigned to this location.",
    },
  };
}

export async function ensurePrimaryLocation(shopId, client = db) {
  const existing = await client.storeLocation.findFirst({ where: { shopId, isPrimary: true } });
  if (existing) return existing;
  const shop = await client.shop.findUnique({ where: { id: shopId } });
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  const registration = normalizeLocationRegistration({}, shop, { inheritWhenOmitted: true });
  // Several freshly opened tabs can request the location list together. A
  // find-then-create sequence makes all of them observe "missing" and turns the
  // expected loser into a noisy P2002 (or, with SQLite, a fatal concurrent-write
  // edge). The shop/code unique key gives the expected loser one authoritative
  // row to resolve below.
  const mainLocation = {
    shopId,
    code: "MAIN",
    name: `${shop.name} - Main`,
    address: shop.address,
    city: shop.city,
    gstNumber: registration.gstNumber ?? null,
    gstStateCode: registration.gstStateCode ?? null,
    gstLegalName: registration.gstLegalName ?? shop.name,
    gstTradeName: shop.name,
    gstRegistrationType: registration.gstRegistrationType ?? (shop.gstNumber ? "regular" : "unregistered"),
    phone: shop.phone,
    isPrimary: true,
  };
  try {
    return await client.storeLocation.upsert({
      where: { shopId_code: { shopId, code: "MAIN" } },
      create: mainLocation,
      update: {},
    });
  } catch (error) {
    // Prisma can implement an upsert as SELECT + INSERT. Under PostgreSQL two
    // genuinely parallel first requests may therefore both choose INSERT and
    // one loses on the unique (shopId, code) key. The winner has already made
    // the exact row we need, so resolve that row instead of turning a harmless
    // startup race into a 409 on billing, barcode binding, or location loading.
    if (error?.code !== "P2002") throw error;
    const racedLocation = await client.storeLocation.findUnique({
      where: { shopId_code: { shopId, code: "MAIN" } },
    });
    if (racedLocation) return racedLocation;
    throw error;
  }
}

export async function listLocations(shopId, user = null) {
  await ensurePrimaryLocation(shopId);
  const accessibleIds = user ? await accessibleLocationIds(shopId, user.userId, user.role) : null;
  const [locations, limits] = await Promise.all([
    db.storeLocation.findMany({
      where: { shopId, ...(accessibleIds && { id: { in: accessibleIds } }) },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
      include: { _count: { select: { stocks: true, outgoingTransfers: true, incomingTransfers: true } } },
    }),
    getPlanLimits(shopId),
  ]);
  return {
    locations: locations.map(locationWithRegistrationStatus),
    usage: { current: locations.filter((row) => row.active).length, maximum: limits.maxStores },
    accessScoped: Boolean(accessibleIds),
  };
}

export async function createLocation(shopId, data, rawActor = {}) {
  const actor = normalizeActor(rawActor);
  await ensurePrimaryLocation(shopId);
  const limits = await getPlanLimits(shopId);
  const location = await db.$transaction(async (tx) => {
    const [activeCount, shop] = await Promise.all([
      tx.storeLocation.count({ where: { shopId, active: true } }),
      tx.shop.findUnique({ where: { id: shopId } }),
    ]);
    if (activeCount >= limits.maxStores) {
      const error = new AppError(`Your plan supports ${limits.maxStores} active store location${limits.maxStores === 1 ? "" : "s"}.`, 403, "STORE_LIMIT_REACHED");
      error.publicData = { usage: { current: activeCount, maximum: limits.maxStores } };
      throw error;
    }
    if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
    const normalized = normalizeLocationRegistration(data, shop, { inheritWhenOmitted: true });
    const created = await tx.storeLocation.create({ data: { shopId, ...normalized, isPrimary: false } });
    const registration = validateGstin(created.gstNumber);
    await writeRequiredStoreAudit({
      shopId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      req: actor.req,
      action: "STORE_LOCATION_CREATED",
      entityType: "StoreLocation",
      entityId: created.id,
      after: locationAuditSnapshot(created),
      metadata: { registrationFormatValidated: registration.valid, portalVerified: false },
    }, tx);
    return created;
  }, { isolationLevel: "Serializable" });
  return locationWithRegistrationStatus(location);
}

export async function getLocationForAudit(shopId, locationId) {
  return db.storeLocation.findFirst({
    where: { id: locationId, shopId },
    select: { id: true, code: true, name: true, address: true, city: true, gstNumber: true, gstStateCode: true, gstLegalName: true, gstTradeName: true, gstRegistrationType: true, phone: true, active: true, isPrimary: true },
  });
}

export async function updateLocation(shopId, locationId, data, rawActor = {}) {
  const actor = normalizeActor(rawActor);
  const updated = await db.$transaction(async (tx) => {
    const [location, shop] = await Promise.all([
      tx.storeLocation.findFirst({ where: { id: locationId, shopId } }),
      tx.shop.findUnique({ where: { id: shopId } }),
    ]);
    if (!location) throw new AppError("Store location not found", 404, "STORE_LOCATION_NOT_FOUND");
    if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
    if (location.isPrimary && data.active === false) {
      throw new AppError("The primary location cannot be deactivated", 409, "PRIMARY_LOCATION_REQUIRED");
    }
    const normalized = normalizeLocationRegistration(data, shop, { existingLocation: location });
    const changed = await tx.storeLocation.updateMany({
      where: { id: location.id, shopId, updatedAt: location.updatedAt },
      data: normalized,
    });
    if (changed.count !== 1) throw new AppError("Store location changed while saving; retry", 409, "STORE_LOCATION_CONCURRENT_CHANGE");
    const result = await tx.storeLocation.findUniqueOrThrow({ where: { id: location.id } });
    const registration = validateGstin(result.gstNumber);
    await writeRequiredStoreAudit({
      shopId,
      userId: actor.userId,
      deviceId: actor.deviceId,
      req: actor.req,
      action: "STORE_LOCATION_UPDATED",
      entityType: "StoreLocation",
      entityId: result.id,
      before: locationAuditSnapshot(location),
      after: locationAuditSnapshot(result),
      metadata: { registrationFormatValidated: registration.valid, portalVerified: false },
    }, tx);
    return result;
  });
  return locationWithRegistrationStatus(updated);
}

async function inventorySnapshot(client, shopId, location) {
  const [products, secondary, openTransferItems] = await Promise.all([
    client.product.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, barcode: true, sku: true, baseUnit: true, displayUnit: true, stockBaseQty: true, lowStockThreshold: true, reorderLevel: true, hsn: true, gstRate: true, batchTrackingEnabled: true },
    }),
    // Product-level rows only. This is keyed by `${locationId}:${productId}`, so
    // variant rows would collide on that key and the last one read would win.
    client.locationStock.findMany({ where: { shopId, sellingUnitId: null }, select: { locationId: true, productId: true, stockBaseQty: true, lowStockThreshold: true } }),
    client.stockTransferItem.findMany({
      where: { transfer: { shopId, status: { in: ["in_transit", "partially_received"] } } },
      select: { productId: true, quantityBaseQty: true, receivedBaseQty: true },
    }),
  ]);
  const rowsByKey = new Map(secondary.map((row) => [`${row.locationId}:${row.productId}`, row]));
  const allocated = new Map();
  for (const row of secondary) allocated.set(row.productId, (allocated.get(row.productId) ?? 0) + Number(row.stockBaseQty));
  // The primary location is the company total minus every explicit secondary
  // allocation. Stock between locations has no allocation yet, so reserve its
  // unreceived quantity as well or it would briefly appear sellable at primary.
  const inTransit = new Map();
  for (const row of openTransferItems) {
    const remaining = Math.max(0, Number(row.quantityBaseQty) - Number(row.receivedBaseQty));
    inTransit.set(row.productId, (inTransit.get(row.productId) ?? 0) + remaining);
  }

  return products.map((product) => {
    const explicit = rowsByKey.get(`${location.id}:${product.id}`);
    const stockBaseQty = location.isPrimary
      ? Number(product.stockBaseQty) - (allocated.get(product.id) ?? 0) - (inTransit.get(product.id) ?? 0)
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
  return { location: locationWithRegistrationStatus(location), products: await inventorySnapshot(db, shopId, location) };
}

export async function getBranchReplenishmentSuggestions(shopId, user = null) {
  await ensurePrimaryLocation(shopId);
  const accessibleIds = user ? await accessibleLocationIds(shopId, user.userId, user.role) : null;
  const locations = await db.storeLocation.findMany({
    where: { shopId, active: true, ...(accessibleIds && { id: { in: accessibleIds } }) },
    orderBy: [{ isPrimary: "desc" }, { name: "asc" }],
  });
  const primary = locations.find((location) => location.isPrimary);
  const destinations = locations.filter((location) => !location.isPrimary);
  if (!primary || destinations.length === 0) {
    return { generatedAt: new Date().toISOString(), sourceLocation: primary ? locationWithRegistrationStatus(primary) : null, suggestions: [] };
  }

  const [primaryInventory, incomingItems] = await Promise.all([
    inventorySnapshot(db, shopId, primary),
    db.stockTransferItem.findMany({
      where: {
        transfer: {
          shopId,
          toLocationId: { in: destinations.map((location) => location.id) },
          status: { in: ["in_transit", "partially_received"] },
        },
      },
      select: {
        productId: true,
        quantityBaseQty: true,
        receivedBaseQty: true,
        transfer: { select: { toLocationId: true } },
      },
    }),
  ]);
  const primaryByProduct = new Map(primaryInventory.map((product) => [product.id, product]));
  const incomingByLocationProduct = new Map();
  for (const item of incomingItems) {
    const key = `${item.transfer.toLocationId}:${item.productId}`;
    const remaining = Math.max(0, Number(item.quantityBaseQty) - Number(item.receivedBaseQty));
    incomingByLocationProduct.set(key, (incomingByLocationProduct.get(key) ?? 0) + remaining);
  }

  const destinationInventories = await Promise.all(destinations.map(async (location) => ({
    location,
    products: await inventorySnapshot(db, shopId, location),
  })));
  const suggestions = [];
  for (const { location, products } of destinationInventories) {
    for (const product of products) {
      const threshold = Number(product.lowStockThreshold || 0);
      if (!(threshold > 0) || Number(product.stockBaseQty) > threshold) continue;
      const incomingBaseQty = Number(incomingByLocationProduct.get(`${location.id}:${product.id}`) ?? 0);
      const projectedBaseQty = Number(product.stockBaseQty) + incomingBaseQty;
      if (projectedBaseQty > threshold) continue;
      const sourceAvailableBaseQty = Math.max(0, Number(primaryByProduct.get(product.id)?.stockBaseQty ?? 0));
      if (!(sourceAvailableBaseQty > 0)) continue;
      const configuredBatch = Math.max(0, Number(product.reorderLevel || 0));
      const targetBaseQty = threshold + Math.max(threshold, configuredBatch);
      const requestedBaseQty = Math.max(0, targetBaseQty - projectedBaseQty);
      const recommendedTransferBaseQty = Math.min(sourceAvailableBaseQty, requestedBaseQty);
      if (!(recommendedTransferBaseQty > 0)) continue;
      suggestions.push({
        destinationLocation: locationWithRegistrationStatus(location),
        productId: product.id,
        productName: product.name,
        baseUnit: product.baseUnit,
        stockBaseQty: Number(product.stockBaseQty),
        lowStockThreshold: threshold,
        incomingBaseQty,
        projectedBaseQty,
        sourceAvailableBaseQty,
        targetBaseQty,
        recommendedTransferBaseQty,
        supplyLimited: recommendedTransferBaseQty < requestedBaseQty,
        reasonCode: Number(product.stockBaseQty) <= 0 ? "out_of_stock" : "below_branch_threshold",
        explanation: `${location.name} has ${Number(product.stockBaseQty)} ${product.baseUnit}, ${incomingBaseQty} incoming, and a ${threshold} ${product.baseUnit} low-stock threshold. Move ${recommendedTransferBaseQty} ${product.baseUnit} from ${primary.name}${recommendedTransferBaseQty < requestedBaseQty ? " (limited by source availability)" : ""}.`,
      });
    }
  }
  suggestions.sort((left, right) => {
    const leftRatio = left.projectedBaseQty / left.lowStockThreshold;
    const rightRatio = right.projectedBaseQty / right.lowStockThreshold;
    return leftRatio - rightRatio || left.destinationLocation.name.localeCompare(right.destinationLocation.name) || left.productName.localeCompare(right.productName);
  });
  return { generatedAt: new Date().toISOString(), sourceLocation: locationWithRegistrationStatus(primary), suggestions };
}

function normalizeItems(items) {
  const totals = new Map();
  for (const item of items) {
    const sellingUnitId = item.sellingUnitId || null;
    // Keyed by size, not by product alone. Merging two sizes into one line would
    // put the shirts on the van without recording which ones went, which is the
    // whole thing a per-size transfer exists to say.
    const key = `${item.productId}:${sellingUnitId ?? ""}`;
    const current = totals.get(key) ?? {
      productId: item.productId,
      sellingUnitId,
      sellingUnitQty: 0,
      quantityBaseQty: 0,
      declaredTaxableValue: 0,
      hasDeclaredValue: false,
    };
    current.quantityBaseQty += Number(item.quantityBaseQty);
    if (item.sellingUnitQty != null) current.sellingUnitQty += Number(item.sellingUnitQty);
    if (item.declaredTaxableValue !== undefined) {
      current.declaredTaxableValue = addMoney(current.declaredTaxableValue, Number(item.declaredTaxableValue));
      current.hasDeclaredValue = true;
    }
    totals.set(key, current);
  }
  // A pooled line carries no count of its own; null keeps it out of the per-size
  // maths rather than reading as a real zero.
  return [...totals.values()].map((row) => ({ ...row, sellingUnitQty: row.sellingUnitQty > 0 ? round2(row.sellingUnitQty) : null }));
}

/**
 * Move one size's count at one location, alongside the base-unit row that every
 * transfer already moves. `qty` is signed: negative leaves, positive arrives.
 *
 * The primary location keeps no row — its share is onHandQty minus what the
 * branches hold — so it is skipped here exactly as the base-unit paths skip it.
 * Writing a primary row would double-count the moment anything read it.
 */
async function moveVariantAtLocation(tx, { shopId, location, productId, sellingUnitId, qty }) {
  if (!sellingUnitId || !location || location.isPrimary) return;
  const amount = round2(qty);
  if (!amount) return;
  await writeLocationStockRow(tx, { shopId, locationId: location.id, productId, sellingUnitId, delta: amount });
}

/**
 * The share of a line's size count that corresponds to part of its base quantity.
 *
 * A shipment can be received or cancelled in pieces, and the two numbers have to
 * move together or the size counts drift away from the base units they describe.
 * Whole-line moves — much the commonest — come out exact.
 */
function variantShareOf(item, baseQty) {
  const lineBase = Number(item.quantityBaseQty || 0);
  const lineUnits = Number(item.sellingUnitQty || 0);
  if (!item.sellingUnitId || !(lineBase > 0) || !(lineUnits > 0)) return 0;
  return round2(lineUnits * (Number(baseQty || 0) / lineBase));
}

const transferInclude = {
  fromLocation: true,
  toLocation: true,
  items: {
    include: {
      lotAllocations: { orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }] },
    },
  },
};

function transferLotSnapshot(lot, quantityBaseQty) {
  return {
    sourceInventoryLotId: lot.id,
    sellingUnitId: lot.sellingUnitId ?? null,
    batchNumber: lot.batchNumber,
    manufacturedOn: lot.manufacturedOn,
    expiresOn: lot.expiresOn,
    quantityBaseQty,
    receivedBaseQty: 0,
    costPerRateUnit: Number(lot.costPerRateUnit),
    costPerRateUnitPaise: lot.costPerRateUnitPaise ?? null,
    mrp: lot.mrp == null ? null : Number(lot.mrp),
    mrpPaise: lot.mrpPaise ?? null,
    sourceStatus: lot.status,
    sourceNote: lot.note ?? null,
  };
}

/** Reserve exact FEFO batches at dispatch, in the same transaction as location stock. */
async function reserveTransferLots(tx, { shopId, locationId, product, item }) {
  if (!product.batchTrackingEnabled) return [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const lots = await tx.inventoryLot.findMany({
    where: {
      shopId,
      locationId,
      productId: product.id,
      status: "active",
      availableBaseQty: { gt: 0 },
      expiresOn: { gte: today },
      // Modern per-pack receipts carry a size. Legacy pooled lots are still
      // eligible because refusing them would strand valid pre-migration stock.
      ...(item.sellingUnitId
        ? { OR: [{ sellingUnitId: item.sellingUnitId }, { sellingUnitId: null }] }
        : {}),
    },
    orderBy: [{ expiresOn: "asc" }, { createdAt: "asc" }],
  });
  const available = round2(lots.reduce((sum, lot) => sum + Number(lot.availableBaseQty), 0));
  if (available + 0.0001 < Number(item.quantityBaseQty)) {
    const error = new AppError(
      `${product.name} has only ${available} ${product.baseUnit} in saleable batches at this branch`,
      409,
      "TRANSFER_BATCH_STOCK_INSUFFICIENT",
    );
    error.publicData = {
      productId: product.id,
      requestedBaseQty: Number(item.quantityBaseQty),
      availableBatchBaseQty: available,
      locationId,
    };
    throw error;
  }

  let remaining = round2(Number(item.quantityBaseQty));
  const allocations = [];
  for (const lot of lots) {
    if (remaining <= 0.0001) break;
    const quantity = round2(Math.min(remaining, Number(lot.availableBaseQty)));
    if (quantity <= 0) continue;
    const depletesLot = Number(lot.availableBaseQty) - quantity <= 0.0001;
    const claimed = await tx.inventoryLot.updateMany({
      where: { id: lot.id, shopId, locationId, status: "active", availableBaseQty: { gte: quantity } },
      data: {
        availableBaseQty: { decrement: quantity },
        ...(depletesLot ? { status: "depleted" } : {}),
      },
    });
    if (claimed.count !== 1) {
      throw new AppError("Batch stock changed during transfer dispatch; refresh and retry", 409, "CONCURRENT_TRANSFER_BATCH_CHANGE");
    }
    allocations.push(transferLotSnapshot(lot, quantity));
    remaining = round2(remaining - quantity);
  }
  if (remaining > 0.0001) {
    throw new AppError("Transfer batch allocation did not cover the dispatched quantity", 409, "TRANSFER_BATCH_ALLOCATION_DRIFT");
  }
  return allocations;
}

async function receiveTransferLots(tx, { shopId, transfer, item, quantityBaseQty }) {
  const allocations = item.lotAllocations ?? [];
  if (allocations.length === 0) return [];
  let remaining = round2(Number(quantityBaseQty));
  const received = [];
  for (const allocation of allocations) {
    if (remaining <= 0.0001) break;
    const allocationRemaining = round2(Number(allocation.quantityBaseQty) - Number(allocation.receivedBaseQty));
    if (allocationRemaining <= 0) continue;
    const quantity = round2(Math.min(remaining, allocationRemaining));
    const claimed = await tx.stockTransferLotAllocation.updateMany({
      where: {
        id: allocation.id,
        transferItemId: item.id,
        receivedBaseQty: Number(allocation.receivedBaseQty),
      },
      data: { receivedBaseQty: { increment: quantity } },
    });
    if (claimed.count !== 1) {
      throw new AppError("Batch receipt quantities changed; refresh and retry", 409, "CONCURRENT_TRANSFER_BATCH_RECEIPT");
    }

    const destinationLot = await tx.inventoryLot.upsert({
      where: {
        shopId_locationId_productId_batchNumber_expiresOn: {
          shopId,
          locationId: transfer.toLocationId,
          productId: item.productId,
          batchNumber: allocation.batchNumber,
          expiresOn: allocation.expiresOn,
        },
      },
      create: {
        shopId,
        locationId: transfer.toLocationId,
        productId: item.productId,
        purchaseReceiptItemId: null,
        sellingUnitId: allocation.sellingUnitId ?? item.sellingUnitId ?? null,
        batchNumber: allocation.batchNumber,
        manufacturedOn: allocation.manufacturedOn,
        expiresOn: allocation.expiresOn,
        receivedBaseQty: quantity,
        availableBaseQty: quantity,
        costPerRateUnit: Number(allocation.costPerRateUnit),
        costPerRateUnitPaise: allocation.costPerRateUnitPaise ?? null,
        mrp: allocation.mrp == null ? null : Number(allocation.mrp),
        mrpPaise: allocation.mrpPaise ?? null,
        status: allocation.sourceStatus || "active",
        note: `Received by transfer ${transfer.referenceNo} from ${transfer.fromLocation.name}`,
      },
      update: {
        receivedBaseQty: { increment: quantity },
        availableBaseQty: { increment: quantity },
      },
    });
    // Receiving stock may reopen a depleted batch, but must never silently
    // release a batch the destination has quarantined or recalled.
    await tx.inventoryLot.updateMany({
      where: { id: destinationLot.id, status: "depleted", availableBaseQty: { gt: 0 } },
      data: { status: allocation.sourceStatus === "depleted" ? "active" : allocation.sourceStatus || "active" },
    });
    received.push({
      allocationId: allocation.id,
      destinationInventoryLotId: destinationLot.id,
      batchNumber: allocation.batchNumber,
      expiresOn: allocation.expiresOn,
      quantityBaseQty: quantity,
    });
    remaining = round2(remaining - quantity);
  }
  if (remaining > 0.0001) {
    throw new AppError("Transfer receipt exceeded its recorded batch allocation", 409, "TRANSFER_BATCH_ALLOCATION_DRIFT");
  }
  return received;
}

async function restoreUnreceivedTransferLots(tx, { shopId, item }) {
  const restored = [];
  for (const allocation of item.lotAllocations ?? []) {
    const quantity = round2(Math.max(0, Number(allocation.quantityBaseQty) - Number(allocation.receivedBaseQty)));
    if (quantity <= 0) continue;
    const sourceLot = await tx.inventoryLot.findFirst({
      where: { id: allocation.sourceInventoryLotId, shopId },
      select: { id: true, status: true },
    });
    if (!sourceLot) throw new AppError("The source batch for this transfer no longer exists", 409, "TRANSFER_SOURCE_BATCH_MISSING");
    await tx.inventoryLot.update({
      where: { id: sourceLot.id },
      data: { availableBaseQty: { increment: quantity } },
    });
    if (sourceLot.status === "depleted") {
      await tx.inventoryLot.update({
        where: { id: sourceLot.id },
        data: { status: allocation.sourceStatus === "depleted" ? "active" : allocation.sourceStatus || "active" },
      });
    }
    restored.push({
      allocationId: allocation.id,
      sourceInventoryLotId: sourceLot.id,
      batchNumber: allocation.batchNumber,
      quantityBaseQty: quantity,
    });
  }
  return restored;
}

function classifyTransfer(from, to) {
  const source = registrationSnapshot(from);
  const destination = registrationSnapshot(to);
  if (source.registered !== destination.registered) {
    const error = new AppError("Both locations need valid GST registrations, or both must be explicitly unregistered, before stock can move", 422, "TRANSFER_REGISTRATION_INCOMPLETE");
    error.publicData = { fromRegistered: source.registered, toRegistered: destination.registered };
    throw error;
  }
  if (!source.registered) return { source, destination, treatment: "unregistered_internal", registered: false, interstate: false };
  return {
    source,
    destination,
    treatment: source.gstin === destination.gstin ? "same_registration_movement" : "distinct_registration_supply",
    registered: true,
    interstate: source.stateCode !== destination.stateCode,
  };
}

function fiscalYearKey(date) {
  const year = date.getUTCFullYear();
  const start = date.getUTCMonth() >= 3 ? year : year - 1;
  return `${String(start).slice(-2)}${String(start + 1).slice(-2)}`;
}

async function nextDeliveryChallanNumber(tx, shopId, date) {
  const fiscalYear = fiscalYearKey(date);
  const counter = await tx.transferDocumentCounter.upsert({
    where: { shopId_fiscalYear_documentType: { shopId, fiscalYear, documentType: "delivery_challan" } },
    create: { shopId, fiscalYear, documentType: "delivery_challan", lastNumber: 1 },
    update: { lastNumber: { increment: 1 } },
    select: { lastNumber: true },
  });
  if (counter.lastNumber > 999999) throw new AppError("Delivery challan series is exhausted for this financial year", 409, "TRANSFER_DOCUMENT_SERIES_EXHAUSTED");
  return `DC-${fiscalYear}-${String(counter.lastNumber).padStart(6, "0")}`;
}

function parseDocumentDate(value) {
  return value ? new Date(`${value}T00:00:00.000Z`) : new Date();
}

function transferComplianceNotice(transfer) {
  if (transfer.gstTreatment === "unregistered_internal") {
    return "Internal stock record; no GST registration was assigned to either location.";
  }
  if (transfer.eWayReviewStatus === "external_reference_recorded") {
    return "An external 12-digit e-way bill reference was recorded. KiranaOS has not verified it against the e-way bill portal and did not submit it.";
  }
  if (transfer.eWayReviewStatus === "not_required_after_review") {
    return "E-way applicability was reviewed and marked not required with retained reason evidence; KiranaOS does not make the legal determination.";
  }
  return transfer.eWayReviewRequired || transfer.eWayReviewStatus === "pending"
    ? "Documented locally. Review e-way bill applicability and submit through a certified GST provider when legally required."
    : "GSTIN format and document fields were validated locally; GSTN status and legal submission are not verified.";
}

function decorateTransfer(transfer) {
  const legalSubmissionStatus = transfer.eWayReviewStatus === "external_reference_recorded"
    ? "external_reference_recorded_not_verified"
    : "not_submitted";
  const items = (transfer.items ?? []).map((item) => ({
    ...item,
    remainingBaseQty: round2(Math.max(0, Number(item.quantityBaseQty) - Number(item.receivedBaseQty))),
    lotAllocations: (item.lotAllocations ?? []).map((allocation) => ({
      ...allocation,
      remainingBaseQty: round2(Math.max(0, Number(allocation.quantityBaseQty) - Number(allocation.receivedBaseQty))),
    })),
  }));
  return {
    ...transfer,
    items,
    receiptSummary: {
      lineCount: items.length,
      completedLineCount: items.filter((item) => item.remainingBaseQty <= 0.0001).length,
      openLineCount: items.filter((item) => item.remainingBaseQty > 0.0001).length,
    },
    legalSubmissionStatus,
    complianceNotice: transferComplianceNotice(transfer),
  };
}

export async function createTransfer(shopId, data, userId, userRole = "staff", req = null) {
  if (data.fromLocationId === data.toLocationId) {
    throw new AppError("Source and destination locations must be different", 400, "SAME_TRANSFER_LOCATION");
  }
  const items = normalizeItems(data.items);
  const fulfillmentMode = data.fulfillmentMode || "instant";
  try {
    const transfer = await db.$transaction(async (tx) => {
      await assertLocationCapability({ shopId, userId, role: userRole, locationId: data.fromLocationId, capability: "transfer", client: tx });
      await assertLocationCapability({ shopId, userId, role: userRole, locationId: data.toLocationId, capability: "transfer", client: tx });
      const locations = await tx.storeLocation.findMany({
        where: { shopId, id: { in: [data.fromLocationId, data.toLocationId] }, active: true },
      });
      if (locations.length !== 2) throw new AppError("An active source or destination location was not found", 404, "STORE_LOCATION_NOT_FOUND");
      const from = locations.find((row) => row.id === data.fromLocationId);
      const to = locations.find((row) => row.id === data.toLocationId);
      const classification = classifyTransfer(from, to);
      const [sourceSnapshot, destinationSnapshot] = await Promise.all([
        inventorySnapshot(tx, shopId, from),
        inventorySnapshot(tx, shopId, to),
      ]);
      const sourceById = new Map(sourceSnapshot.map((row) => [row.id, row]));
      const sourceBalances = new Map(sourceSnapshot.map((row) => [row.id, Number(row.stockBaseQty)]));
      const destinationBalances = new Map(destinationSnapshot.map((row) => [row.id, Number(row.stockBaseQty)]));

      // A product that holds stock per size cannot move as an untyped lump: the
      // product-level allocation would shift while the per-size rows stood still,
      // and the two views would disagree from then on. Refusing is recoverable;
      // silent drift is not — the same rule the sale path applies.
      const perPackIds = items.filter((item) => !item.sellingUnitId).map((item) => item.productId);
      if (perPackIds.length > 0) {
        const perPack = await tx.product.findMany({
          where: { shopId, id: { in: perPackIds }, packagingMode: "per_pack" },
          select: { id: true, name: true },
        });
        if (perPack.length > 0) {
          const error = new AppError(
            `"${perPack[0].name}" is counted per size, so a transfer must say which size is moving.`,
            400,
            "PACKAGING_STOCK_PATH_UNSUPPORTED",
          );
          error.publicData = { productIds: perPack.map((row) => row.id) };
          throw error;
        }
      }

      for (const item of items) {
        const product = sourceById.get(item.productId);
        if (!product) throw new AppError("A transfer product was not found", 404, "PRODUCT_NOT_FOUND");
        if (item.sellingUnitId) {
          const available = await getVariantLocationQuantity(tx, shopId, from, product, item.sellingUnitId);
          const moving = Number(item.sellingUnitQty ?? 0);
          if (!(moving > 0)) {
            throw new AppError(`Enter how many of each size of ${product.name} are moving`, 422, "TRANSFER_SIZE_QTY_REQUIRED");
          }
          if (available < moving) {
            const error = new AppError(`${product.name} has only ${available} of that size at ${from.name}`, 409, "INSUFFICIENT_LOCATION_STOCK");
            error.publicData = { productId: product.id, sellingUnitId: item.sellingUnitId, availableQty: available };
            throw error;
          }
        }
        if (product.stockBaseQty < item.quantityBaseQty) {
          const error = new AppError(`${product.name} has only ${product.stockBaseQty} ${product.baseUnit} at ${from.name}`, 409, "INSUFFICIENT_LOCATION_STOCK");
          error.publicData = { productId: product.id, availableBaseQty: product.stockBaseQty };
          throw error;
        }
        if (classification.registered && (!item.hasDeclaredValue || !(item.declaredTaxableValue > 0))) {
          const error = new AppError(`Enter the taxable transfer value for ${product.name}`, 422, "TRANSFER_VALUE_REQUIRED");
          error.publicData = { productId: product.id, productName: product.name };
          throw error;
        }
        if (classification.registered && Number(product.gstRate) > 0 && !validateHsn(product.hsn).valid) {
          const error = new AppError(`${product.name} needs a valid 4, 6 or 8 digit HSN before a registered transfer`, 422, "TRANSFER_HSN_REQUIRED");
          error.publicData = { productId: product.id, productName: product.name };
          throw error;
        }
      }

      let documentType = data.documentType || null;
      let documentNumber = data.documentNumber || null;
      let documentDate = data.documentDate ? parseDocumentDate(data.documentDate) : null;
      if (classification.treatment === "same_registration_movement") {
        if (documentType && documentType !== "delivery_challan") {
          throw new AppError("Movement within one GST registration must use a delivery challan", 422, "DELIVERY_CHALLAN_REQUIRED");
        }
        documentType = "delivery_challan";
        documentDate = documentDate || new Date();
        documentNumber = documentNumber || await nextDeliveryChallanNumber(tx, shopId, documentDate);
      } else if (classification.treatment === "distinct_registration_supply") {
        if (documentType !== "tax_invoice") {
          throw new AppError("A transfer between distinct GST registrations must reference a tax invoice", 422, "TRANSFER_TAX_INVOICE_REQUIRED");
        }
        if (!documentNumber || !documentDate) {
          throw new AppError("Tax invoice number and document date are required for a distinct-registration transfer", 422, "TRANSFER_DOCUMENT_REQUIRED");
        }
      } else if (documentType || documentNumber || documentDate) {
        if (!documentType || !documentNumber || !documentDate) {
          throw new AppError("Document type, number, and date must be entered together", 422, "TRANSFER_DOCUMENT_INCOMPLETE");
        }
      }

      const transferItems = items.map((item) => {
        const product = sourceById.get(item.productId);
        const taxableValue = item.hasDeclaredValue ? round2(item.declaredTaxableValue) : 0;
        const taxTotal = classification.treatment === "distinct_registration_supply"
          ? multiplyMoney(taxableValue, Number(product.gstRate || 0) / 100)
          : 0;
        const igst = classification.interstate ? taxTotal : 0;
        const cgst = classification.interstate ? 0 : round2(taxTotal / 2);
        const sgst = classification.interstate ? 0 : round2(taxTotal - cgst);
        const totalValue = addMoney(taxableValue, taxTotal);
        return {
          productId: item.productId,
          productName: product.name,
          sellingUnitId: item.sellingUnitId,
          sellingUnitQty: item.sellingUnitQty,
          quantityBaseQty: item.quantityBaseQty,
          baseUnit: product.baseUnit,
          hsn: product.hsn || null,
          gstRate: Number(product.gstRate || 0),
          taxableValue,
          cgst,
          sgst,
          igst,
          taxTotal,
          totalValue,
          ...moneyShadows({ taxableValue, cgst, sgst, igst, taxTotal, totalValue }),
        };
      });
      for (const transferItem of transferItems) {
        const lotAllocations = await reserveTransferLots(tx, {
          shopId,
          locationId: from.id,
          product: sourceById.get(transferItem.productId),
          item: transferItem,
        });
        if (lotAllocations.length > 0) transferItem.lotAllocations = { create: lotAllocations };
      }
      const taxableValue = sumMoney(transferItems.map((item) => item.taxableValue));
      const cgst = sumMoney(transferItems.map((item) => item.cgst));
      const sgst = sumMoney(transferItems.map((item) => item.sgst));
      const igst = sumMoney(transferItems.map((item) => item.igst));
      const taxTotal = sumMoney(transferItems.map((item) => item.taxTotal));
      const consignmentValue = sumMoney(transferItems.map((item) => item.totalValue));
      const eWayReviewRequired = classification.registered && consignmentValue > 50000;
      const now = new Date();
      const completesImmediately = fulfillmentMode === "instant";

      for (const item of items) {
        if (!from.isPrimary) {
          const updated = await tx.locationStock.updateMany({
            // sellingUnitId: null is load-bearing, not decoration. Without it this
            // matches the product's variant rows too, so count comes back as 3 for a
            // two-size product and the transfer dies with a bogus concurrency error —
            // after having decremented all three.
            where: { locationId: from.id, productId: item.productId, shopId, sellingUnitId: null, stockBaseQty: { gte: item.quantityBaseQty } },
            data: { stockBaseQty: { decrement: item.quantityBaseQty } },
          });
          if (updated.count !== 1) throw new AppError("Location stock changed; retry the transfer", 409, "CONCURRENT_LOCATION_STOCK_CHANGE");
        }
        // The size leaves the source in the same transaction as the base units, so
        // the per-size and base-unit views can never disagree about this movement.
        await moveVariantAtLocation(tx, {
          shopId, location: from, productId: item.productId,
          sellingUnitId: item.sellingUnitId, qty: -Number(item.sellingUnitQty || 0),
        });
        if (completesImmediately) {
          if (!to.isPrimary) {
            await writeLocationStockRow(tx, { shopId, locationId: to.id, productId: item.productId, delta: item.quantityBaseQty });
          }
          await moveVariantAtLocation(tx, {
            shopId, location: to, productId: item.productId,
            sellingUnitId: item.sellingUnitId, qty: Number(item.sellingUnitQty || 0),
          });
        }
      }

      const created = await tx.stockTransfer.create({
        data: {
          shopId,
          referenceNo: transferRef(),
          fromLocationId: from.id,
          toLocationId: to.id,
          status: completesImmediately ? "completed" : "in_transit",
          fulfillmentMode,
          movementReason: data.movementReason || "branch_transfer",
          documentType,
          documentNumber,
          documentDate,
          gstTreatment: classification.treatment,
          fromGstin: classification.source.gstin,
          fromStateCode: classification.source.stateCode,
          toGstin: classification.destination.gstin,
          toStateCode: classification.destination.stateCode,
          isInterstate: classification.interstate,
          complianceStatus: classification.registered ? "documented" : "not_applicable",
          eWayReviewRequired,
          eWayReviewStatus: eWayReviewRequired ? "pending" : "not_required",
          taxableValue,
          cgst,
          sgst,
          igst,
          taxTotal,
          consignmentValue,
          ...moneyShadows({ taxableValue, cgst, sgst, igst, taxTotal, consignmentValue }),
          note: data.note || null,
          createdByUserId: userId || null,
          approvedByUserId: userId || null,
          approvedAt: now,
          dispatchedAt: now,
          expectedArrivalDate: fulfillmentMode === "shipment" && data.expectedArrivalDate ? parseDocumentDate(data.expectedArrivalDate) : null,
          carrierName: fulfillmentMode === "shipment" ? data.carrierName || null : null,
          trackingNumber: fulfillmentMode === "shipment" ? data.trackingNumber || null : null,
          receivedByUserId: completesImmediately ? userId || null : null,
          lastReceivedAt: completesImmediately ? now : null,
          completedAt: completesImmediately ? now : null,
          items: { create: transferItems.map((item) => ({ ...item, receivedBaseQty: completesImmediately ? item.quantityBaseQty : 0 })) },
        },
        include: transferInclude,
      });
      for (const item of created.items) {
        const sourceOld = sourceBalances.get(item.productId) ?? 0;
        const sourceNew = round2(sourceOld - Number(item.quantityBaseQty));
        sourceBalances.set(item.productId, sourceNew);
        await writeTransferStockMovement(tx, {
          shopId,
          transferId: created.id,
          transferItemId: item.id,
          locationId: from.id,
          productId: item.productId,
          productName: item.productName,
          sellingUnitId: item.sellingUnitId,
          sellingUnitQty: item.sellingUnitQty == null ? null : -Number(item.sellingUnitQty),
          action: "transfer_out",
          changeBaseQty: -Number(item.quantityBaseQty),
          oldStockBaseQty: sourceOld,
          newStockBaseQty: sourceNew,
          actor: { userId },
          phase: "dispatch",
          note: `Transfer ${created.referenceNo} dispatched to ${to.name}`,
        });
        if (completesImmediately) {
          await receiveTransferLots(tx, {
            shopId,
            transfer: created,
            item,
            quantityBaseQty: Number(item.quantityBaseQty),
          });
          const destinationOld = destinationBalances.get(item.productId) ?? 0;
          const destinationNew = round2(destinationOld + Number(item.quantityBaseQty));
          destinationBalances.set(item.productId, destinationNew);
          await writeTransferStockMovement(tx, {
            shopId,
            transferId: created.id,
            transferItemId: item.id,
            locationId: to.id,
            productId: item.productId,
            productName: item.productName,
            sellingUnitId: item.sellingUnitId,
            sellingUnitQty: item.sellingUnitQty,
            action: "transfer_in",
            changeBaseQty: Number(item.quantityBaseQty),
            oldStockBaseQty: destinationOld,
            newStockBaseQty: destinationNew,
            actor: { userId },
            phase: "instant-receipt",
            note: `Transfer ${created.referenceNo} received from ${from.name}`,
          });
        }
      }
      await writeRequiredStoreAudit({
        shopId,
        userId,
        req,
        action: created.status === "completed" ? "STOCK_TRANSFER_COMPLETED" : "STOCK_TRANSFER_DISPATCHED",
        entityType: "StockTransfer",
        entityId: created.id,
        metadata: transferAuditMetadata(created),
      }, tx);
      return tx.stockTransfer.findUniqueOrThrow({ where: { id: created.id }, include: transferInclude });
    });
    return decorateTransfer(transfer);
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("That transfer document number already exists", 409, "TRANSFER_DOCUMENT_DUPLICATE");
    throw error;
  }
}

function normalizeReceiptItems(items) {
  const totals = new Map();
  for (const item of items) {
    totals.set(
      item.transferItemId,
      round2((totals.get(item.transferItemId) ?? 0) + Number(item.quantityBaseQty)),
    );
  }
  return [...totals].map(([transferItemId, quantityBaseQty]) => ({ transferItemId, quantityBaseQty }));
}

export async function receiveTransfer(shopId, transferId, data, userId, userRole = "staff", req = null) {
  const receiptItems = normalizeReceiptItems(data.items);
  return db.$transaction(async (tx) => {
    const current = await tx.stockTransfer.findFirst({
      where: { id: transferId, shopId },
      include: transferInclude,
    });
    if (!current) throw new AppError("Stock transfer not found", 404, "STOCK_TRANSFER_NOT_FOUND");
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.fromLocationId, capability: "transfer", client: tx });
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.toLocationId, capability: "transfer", client: tx });
    if (current.fulfillmentMode !== "shipment" || !["in_transit", "partially_received"].includes(current.status)) {
      throw new AppError("Only an open shipment can receive stock", 409, "TRANSFER_NOT_RECEIVABLE");
    }

    const destinationSnapshot = await inventorySnapshot(tx, shopId, current.toLocation);
    const destinationBalances = new Map(destinationSnapshot.map((row) => [row.id, Number(row.stockBaseQty)]));

    const itemById = new Map(current.items.map((item) => [item.id, item]));
    const receivedLines = [];
    for (const input of receiptItems) {
      const item = itemById.get(input.transferItemId);
      if (!item) throw new AppError("A receipt line does not belong to this transfer", 404, "TRANSFER_ITEM_NOT_FOUND");
      const receivedBefore = round2(Number(item.receivedBaseQty));
      const remaining = round2(Number(item.quantityBaseQty) - receivedBefore);
      if (input.quantityBaseQty > remaining + 0.0001) {
        const error = new AppError(`${item.productName} has only ${remaining} ${item.baseUnit} left to receive`, 409, "TRANSFER_RECEIPT_EXCEEDS_REMAINING");
        error.publicData = { transferItemId: item.id, remainingBaseQty: remaining };
        throw error;
      }
      const claimed = await tx.stockTransferItem.updateMany({
        where: { id: item.id, transferId: current.id, receivedBaseQty: receivedBefore },
        data: { receivedBaseQty: { increment: input.quantityBaseQty } },
      });
      if (claimed.count !== 1) throw new AppError("Receipt quantities changed; refresh and retry", 409, "CONCURRENT_TRANSFER_RECEIPT");

      if (!current.toLocation.isPrimary) {
        await writeLocationStockRow(tx, { shopId, locationId: current.toLocationId, productId: item.productId, delta: input.quantityBaseQty });
      }
      // A shipment can arrive in parts, so the size count arrives in the same
      // proportion as the base units it describes.
      await moveVariantAtLocation(tx, {
        shopId, location: current.toLocation, productId: item.productId,
        sellingUnitId: item.sellingUnitId, qty: variantShareOf(item, input.quantityBaseQty),
      });
      const receivedLots = await receiveTransferLots(tx, {
        shopId,
        transfer: current,
        item,
        quantityBaseQty: input.quantityBaseQty,
      });
      const destinationOld = destinationBalances.get(item.productId) ?? 0;
      const destinationNew = round2(destinationOld + Number(input.quantityBaseQty));
      destinationBalances.set(item.productId, destinationNew);
      await writeTransferStockMovement(tx, {
        shopId,
        transferId: current.id,
        transferItemId: item.id,
        locationId: current.toLocationId,
        productId: item.productId,
        productName: item.productName,
        sellingUnitId: item.sellingUnitId,
        sellingUnitQty: item.sellingUnitId ? variantShareOf(item, input.quantityBaseQty) : null,
        action: "transfer_in",
        changeBaseQty: Number(input.quantityBaseQty),
        oldStockBaseQty: destinationOld,
        newStockBaseQty: destinationNew,
        actor: { userId },
        phase: `receipt-${receivedBefore}-${round2(receivedBefore + Number(input.quantityBaseQty))}`,
        note: `Transfer ${current.referenceNo} received from ${current.fromLocation.name}`,
      });
      receivedLines.push({
        transferItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        quantityBaseQty: input.quantityBaseQty,
        receivedBefore,
        receivedAfter: round2(receivedBefore + input.quantityBaseQty),
        batches: receivedLots.map((lot) => ({
          batchNumber: lot.batchNumber,
          expiresOn: lot.expiresOn,
          quantityBaseQty: lot.quantityBaseQty,
        })),
      });
    }

    const refreshedItems = await tx.stockTransferItem.findMany({ where: { transferId: current.id } });
    const completed = refreshedItems.every((item) => Number(item.receivedBaseQty) + 0.0001 >= Number(item.quantityBaseQty));
    const receivedAt = new Date();
    const nextStatus = completed ? "completed" : "partially_received";
    const updated = await tx.stockTransfer.updateMany({
      where: { id: current.id, shopId, status: current.status },
      data: {
        status: nextStatus,
        receivedByUserId: userId || null,
        lastReceivedAt: receivedAt,
        ...(completed ? { completedAt: receivedAt } : {}),
      },
    });
    if (updated.count !== 1) throw new AppError("Transfer status changed; refresh and retry", 409, "CONCURRENT_TRANSFER_RECEIPT");

    await writeRequiredStoreAudit({
      shopId,
      userId,
      action: completed ? "STOCK_TRANSFER_RECEIVED" : "STOCK_TRANSFER_PARTIALLY_RECEIVED",
      entityType: "StockTransfer",
      entityId: current.id,
      before: { status: current.status },
      after: { status: nextStatus, completedAt: completed ? receivedAt : null },
      metadata: { lines: receivedLines, note: data.note || null },
      req,
    }, tx);

    const transfer = await tx.stockTransfer.findUnique({
      where: { id: current.id },
      include: transferInclude,
    });
    return decorateTransfer(transfer);
  });
}

export async function cancelTransfer(shopId, transferId, data, userId, userRole = "staff", req = null) {
  return db.$transaction(async (tx) => {
    const current = await tx.stockTransfer.findFirst({
      where: { id: transferId, shopId },
      include: transferInclude,
    });
    if (!current) throw new AppError("Stock transfer not found", 404, "STOCK_TRANSFER_NOT_FOUND");
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.fromLocationId, capability: "transfer", client: tx });
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.toLocationId, capability: "transfer", client: tx });
    if (current.fulfillmentMode !== "shipment" || !["in_transit", "partially_received"].includes(current.status)) {
      throw new AppError("Only an open shipment can be cancelled", 409, "TRANSFER_NOT_CANCELLABLE");
    }


    const sourceSnapshot = await inventorySnapshot(tx, shopId, current.fromLocation);
    const sourceBalances = new Map(sourceSnapshot.map((row) => [row.id, Number(row.stockBaseQty)]));

    const returnedLines = [];
    for (const item of current.items) {
      const remaining = round2(Math.max(0, Number(item.quantityBaseQty) - Number(item.receivedBaseQty)));
      if (remaining <= 0) continue;
      if (!current.fromLocation.isPrimary) {
        await writeLocationStockRow(tx, { shopId, locationId: current.fromLocationId, productId: item.productId, delta: remaining });
      }
      // Only the part still on the van comes back, in sizes as well as base units.
      await moveVariantAtLocation(tx, {
        shopId, location: current.fromLocation, productId: item.productId,
        sellingUnitId: item.sellingUnitId, qty: variantShareOf(item, remaining),
      });
      const restoredLots = await restoreUnreceivedTransferLots(tx, { shopId, item });
      const sourceOld = sourceBalances.get(item.productId) ?? 0;
      const sourceNew = round2(sourceOld + remaining);
      sourceBalances.set(item.productId, sourceNew);
      await writeTransferStockMovement(tx, {
        shopId,
        transferId: current.id,
        transferItemId: item.id,
        locationId: current.fromLocationId,
        productId: item.productId,
        productName: item.productName,
        sellingUnitId: item.sellingUnitId,
        sellingUnitQty: item.sellingUnitId ? variantShareOf(item, remaining) : null,
        action: "transfer_cancel_reversal",
        changeBaseQty: remaining,
        oldStockBaseQty: sourceOld,
        newStockBaseQty: sourceNew,
        actor: { userId },
        phase: "cancel-return",
        note: `Cancelled transfer ${current.referenceNo}: ${data.reason}`,
      });
      returnedLines.push({
        productId: item.productId,
        productName: item.productName,
        returnedBaseQty: remaining,
        batches: restoredLots.map((lot) => ({ batchNumber: lot.batchNumber, quantityBaseQty: lot.quantityBaseQty })),
      });
    }

    const cancelledAt = new Date();
    const updated = await tx.stockTransfer.updateMany({
      where: { id: current.id, shopId, status: current.status },
      data: {
        status: "cancelled",
        cancelledAt,
        cancelledByUserId: userId || null,
        cancelReason: data.reason,
        eWayReviewRequired: false,
        ...(current.eWayReviewStatus === "pending" ? { eWayReviewStatus: "not_required" } : {}),
      },
    });
    if (updated.count !== 1) throw new AppError("Transfer status changed; refresh and retry", 409, "CONCURRENT_TRANSFER_CANCELLATION");

    await writeRequiredStoreAudit({
      shopId,
      userId,
      action: "STOCK_TRANSFER_CANCELLED",
      entityType: "StockTransfer",
      entityId: current.id,
      before: { status: current.status },
      after: { status: "cancelled", cancelledAt, cancelReason: data.reason },
      metadata: { returnedLines, receivedLinesRetained: current.items.filter((item) => Number(item.receivedBaseQty) > 0).length },
      req,
    }, tx);

    const transfer = await tx.stockTransfer.findUnique({
      where: { id: current.id },
      include: transferInclude,
    });
    return decorateTransfer(transfer);
  });
}

export async function reviewTransferCompliance(shopId, transferId, data, userId, userRole = "staff", req = null) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.stockTransfer.findFirst({
        where: { id: transferId, shopId },
        include: transferInclude,
      });
      if (!current) throw new AppError("Stock transfer not found", 404, "STOCK_TRANSFER_NOT_FOUND");
      await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.fromLocationId, capability: "transfer", client: tx });
      await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.toLocationId, capability: "transfer", client: tx });
      if (current.status === "cancelled") throw new AppError("A cancelled transfer cannot be reviewed", 409, "TRANSFER_NOT_REVIEWABLE");
      if (!current.eWayReviewRequired || current.eWayReviewStatus !== "pending") {
        throw new AppError("This e-way applicability review is already resolved or was never required", 409, "TRANSFER_EWAY_REVIEW_NOT_PENDING");
      }

      const recordsExternalReference = data.decision === "external_reference_recorded";
      const reviewedAt = new Date();
      const updated = await tx.stockTransfer.updateMany({
        where: { id: current.id, shopId, eWayReviewRequired: true, eWayReviewStatus: "pending" },
        data: {
          eWayReviewRequired: false,
          eWayReviewStatus: data.decision,
          eWayBillNumber: recordsExternalReference ? data.eWayBillNumber : null,
          eWayBillDate: recordsExternalReference ? parseDocumentDate(data.eWayBillDate) : null,
          eWayReviewReason: data.reason,
          eWayReviewedAt: reviewedAt,
          eWayReviewedByUserId: userId || null,
        },
      });
      if (updated.count !== 1) throw new AppError("The transfer review changed; refresh and retry", 409, "CONCURRENT_TRANSFER_REVIEW");
      const reviewed = await tx.stockTransfer.findUnique({
        where: { id: current.id },
        include: transferInclude,
      });
      await writeRequiredStoreAudit({
        shopId,
        userId,
        action: "STOCK_TRANSFER_COMPLIANCE_REVIEWED",
        entityType: "StockTransfer",
        entityId: current.id,
        before: { eWayReviewRequired: true, eWayReviewStatus: current.eWayReviewStatus },
        after: {
          eWayReviewRequired: false,
          eWayReviewStatus: reviewed.eWayReviewStatus,
          eWayBillNumber: reviewed.eWayBillNumber,
          eWayBillDate: reviewed.eWayBillDate,
          eWayReviewReason: reviewed.eWayReviewReason,
          eWayReviewedAt: reviewed.eWayReviewedAt,
          eWayReviewedByUserId: reviewed.eWayReviewedByUserId,
        },
        metadata: { portalVerified: false, submittedByKiranaOS: false },
        req,
      }, tx);
      return decorateTransfer(reviewed);
    });
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("That e-way bill number is already recorded on another transfer", 409, "EWAY_BILL_ALREADY_RECORDED");
    throw error;
  }
}
export async function listTransfers(shopId, { limit = 50 } = {}, user = null) {
  const accessibleIds = user ? await accessibleLocationIds(shopId, user.userId, user.role) : null;
  const transfers = await db.stockTransfer.findMany({
    where: {
      shopId,
      ...(accessibleIds && { OR: [{ fromLocationId: { in: accessibleIds } }, { toLocationId: { in: accessibleIds } }] }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(Number(limit) || 50, 1), 100),
    include: transferInclude,
  });
  return transfers.map(decorateTransfer);
}
