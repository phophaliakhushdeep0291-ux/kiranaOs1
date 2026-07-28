import crypto from "crypto";
import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { addMoney, moneyShadows, multiplyMoney, round2, sumMoney } from "../../utils/money.js";
import { validateGstin, validateHsn } from "../../utils/gst.js";
import { getPlanLimits } from "../feature-gates/featureGate.service.js";
import { accessibleLocationIds, assertLocationCapability } from "./location-access.service.js";

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

export async function createLocation(shopId, data) {
  await ensurePrimaryLocation(shopId);
  const [activeCount, limits, shop] = await Promise.all([
    db.storeLocation.count({ where: { shopId, active: true } }),
    getPlanLimits(shopId),
    db.shop.findUnique({ where: { id: shopId } }),
  ]);
  if (activeCount >= limits.maxStores) {
    const error = new AppError(`Your plan supports ${limits.maxStores} active store location${limits.maxStores === 1 ? "" : "s"}.`, 403, "STORE_LIMIT_REACHED");
    error.publicData = { usage: { current: activeCount, maximum: limits.maxStores } };
    throw error;
  }
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  const normalized = normalizeLocationRegistration(data, shop, { inheritWhenOmitted: true });
  const location = await db.storeLocation.create({ data: { shopId, ...normalized, isPrimary: false } });
  return locationWithRegistrationStatus(location);
}

export async function getLocationForAudit(shopId, locationId) {
  return db.storeLocation.findFirst({
    where: { id: locationId, shopId },
    select: { id: true, code: true, name: true, address: true, city: true, gstNumber: true, gstStateCode: true, gstLegalName: true, gstTradeName: true, gstRegistrationType: true, phone: true, active: true, isPrimary: true },
  });
}

export async function updateLocation(shopId, locationId, data) {
  const [location, shop] = await Promise.all([
    db.storeLocation.findFirst({ where: { id: locationId, shopId } }),
    db.shop.findUnique({ where: { id: shopId } }),
  ]);
  if (!location) throw new AppError("Store location not found", 404, "STORE_LOCATION_NOT_FOUND");
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  if (location.isPrimary && data.active === false) {
    throw new AppError("The primary location cannot be deactivated", 409, "PRIMARY_LOCATION_REQUIRED");
  }
  const normalized = normalizeLocationRegistration(data, shop, { existingLocation: location });
  const updated = await db.storeLocation.update({ where: { id: location.id }, data: normalized });
  return locationWithRegistrationStatus(updated);
}

async function inventorySnapshot(client, shopId, location) {
  const [products, secondary] = await Promise.all([
    client.product.findMany({
      where: { shopId, deletedAt: null },
      orderBy: { name: "asc" },
      select: { id: true, name: true, baseUnit: true, displayUnit: true, stockBaseQty: true, lowStockThreshold: true, hsn: true, gstRate: true },
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
  return { location: locationWithRegistrationStatus(location), products: await inventorySnapshot(db, shopId, location) };
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
  return transfer.eWayReviewRequired
    ? "Documented locally. Review e-way bill applicability and submit through a certified GST provider when legally required."
    : "GSTIN format and document fields were validated locally; GSTN status and legal submission are not verified.";
}

function decorateTransfer(transfer) {
  return { ...transfer, legalSubmissionStatus: "not_submitted", complianceNotice: transferComplianceNotice(transfer) };
}

export async function createTransfer(shopId, data, userId, userRole = "staff") {
  if (data.fromLocationId === data.toLocationId) {
    throw new AppError("Source and destination locations must be different", 400, "SAME_TRANSFER_LOCATION");
  }
  const items = normalizeItems(data.items);
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

      return tx.stockTransfer.create({
        data: {
          shopId,
          referenceNo: transferRef(),
          fromLocationId: from.id,
          toLocationId: to.id,
          status: "completed",
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
          taxableValue,
          cgst,
          sgst,
          igst,
          taxTotal,
          consignmentValue,
          ...moneyShadows({ taxableValue, cgst, sgst, igst, taxTotal, consignmentValue }),
          note: data.note || null,
          createdByUserId: userId || null,
          completedAt: new Date(),
          items: { create: transferItems },
        },
        include: { fromLocation: true, toLocation: true, items: true },
      });
    });
    return decorateTransfer(transfer);
  } catch (error) {
    if (error?.code === "P2002") throw new AppError("That transfer document number already exists", 409, "TRANSFER_DOCUMENT_DUPLICATE");
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