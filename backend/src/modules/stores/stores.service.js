import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyShadows, multiplyMoney, round2, sumMoney } from "../../utils/money.js";
import { validateGstin, validateHsn } from "../../utils/gst.js";
import { getPlanLimits } from "../feature-gates/featureGate.service.js";
import { accessibleLocationIds, assertLocationCapability } from "./location-access.service.js";
import { createAuditLog } from "../audit/audit.service.js";

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
  try {
    return await client.storeLocation.create({
      data: {
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
      },
    });
  } catch (error) {
    if (error?.code !== "P2002") throw error;
    return client.storeLocation.findFirst({ where: { shopId, isPrimary: true } });
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
      select: { id: true, name: true, barcode: true, sku: true, baseUnit: true, displayUnit: true, stockBaseQty: true, lowStockThreshold: true, reorderLevel: true, hsn: true, gstRate: true },
    }),
    client.locationStock.findMany({ where: { shopId }, select: { locationId: true, productId: true, stockBaseQty: true, lowStockThreshold: true } }),
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
    const current = totals.get(item.productId) ?? { productId: item.productId, quantityBaseQty: 0, declaredTaxableValue: 0, hasDeclaredValue: false };
    current.quantityBaseQty += Number(item.quantityBaseQty);
    if (item.declaredTaxableValue !== undefined) {
      current.declaredTaxableValue = addMoney(current.declaredTaxableValue, Number(item.declaredTaxableValue));
      current.hasDeclaredValue = true;
    }
    totals.set(item.productId, current);
  }
  return [...totals.values()];
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
            where: { locationId: from.id, productId: item.productId, shopId, stockBaseQty: { gte: item.quantityBaseQty } },
            data: { stockBaseQty: { decrement: item.quantityBaseQty } },
          });
          if (updated.count !== 1) throw new AppError("Location stock changed; retry the transfer", 409, "CONCURRENT_LOCATION_STOCK_CHANGE");
        }
        if (completesImmediately && !to.isPrimary) {
          await tx.locationStock.upsert({
            where: { locationId_productId: { locationId: to.id, productId: item.productId } },
            create: { shopId, locationId: to.id, productId: item.productId, stockBaseQty: item.quantityBaseQty },
            update: { stockBaseQty: { increment: item.quantityBaseQty } },
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
        include: { fromLocation: true, toLocation: true, items: true },
      });
      await writeRequiredStoreAudit({
        shopId,
        userId,
        req,
        action: created.status === "completed" ? "STOCK_TRANSFER_COMPLETED" : "STOCK_TRANSFER_DISPATCHED",
        entityType: "StockTransfer",
        entityId: created.id,
        metadata: transferAuditMetadata(created),
      }, tx);
      return created;
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
      include: { fromLocation: true, toLocation: true, items: true },
    });
    if (!current) throw new AppError("Stock transfer not found", 404, "STOCK_TRANSFER_NOT_FOUND");
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.fromLocationId, capability: "transfer", client: tx });
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.toLocationId, capability: "transfer", client: tx });
    if (current.fulfillmentMode !== "shipment" || !["in_transit", "partially_received"].includes(current.status)) {
      throw new AppError("Only an open shipment can receive stock", 409, "TRANSFER_NOT_RECEIVABLE");
    }

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
        await tx.locationStock.upsert({
          where: { locationId_productId: { locationId: current.toLocationId, productId: item.productId } },
          create: { shopId, locationId: current.toLocationId, productId: item.productId, stockBaseQty: input.quantityBaseQty },
          update: { stockBaseQty: { increment: input.quantityBaseQty } },
        });
      }
      receivedLines.push({
        transferItemId: item.id,
        productId: item.productId,
        productName: item.productName,
        quantityBaseQty: input.quantityBaseQty,
        receivedBefore,
        receivedAfter: round2(receivedBefore + input.quantityBaseQty),
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
      include: { fromLocation: true, toLocation: true, items: true },
    });
    return decorateTransfer(transfer);
  });
}

export async function cancelTransfer(shopId, transferId, data, userId, userRole = "staff", req = null) {
  return db.$transaction(async (tx) => {
    const current = await tx.stockTransfer.findFirst({
      where: { id: transferId, shopId },
      include: { fromLocation: true, toLocation: true, items: true },
    });
    if (!current) throw new AppError("Stock transfer not found", 404, "STOCK_TRANSFER_NOT_FOUND");
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.fromLocationId, capability: "transfer", client: tx });
    await assertLocationCapability({ shopId, userId, role: userRole, locationId: current.toLocationId, capability: "transfer", client: tx });
    if (current.fulfillmentMode !== "shipment" || !["in_transit", "partially_received"].includes(current.status)) {
      throw new AppError("Only an open shipment can be cancelled", 409, "TRANSFER_NOT_CANCELLABLE");
    }

    const returnedLines = [];
    for (const item of current.items) {
      const remaining = round2(Math.max(0, Number(item.quantityBaseQty) - Number(item.receivedBaseQty)));
      if (remaining <= 0) continue;
      if (!current.fromLocation.isPrimary) {
        await tx.locationStock.upsert({
          where: { locationId_productId: { locationId: current.fromLocationId, productId: item.productId } },
          create: { shopId, locationId: current.fromLocationId, productId: item.productId, stockBaseQty: remaining },
          update: { stockBaseQty: { increment: remaining } },
        });
      }
      returnedLines.push({ productId: item.productId, productName: item.productName, returnedBaseQty: remaining });
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
      include: { fromLocation: true, toLocation: true, items: true },
    });
    return decorateTransfer(transfer);
  });
}

export async function reviewTransferCompliance(shopId, transferId, data, userId, userRole = "staff", req = null) {
  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.stockTransfer.findFirst({
        where: { id: transferId, shopId },
        include: { fromLocation: true, toLocation: true, items: true },
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
        include: { fromLocation: true, toLocation: true, items: true },
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
    include: { fromLocation: true, toLocation: true, items: true },
  });
  return transfers.map(decorateTransfer);
}
