import { formatDateInTimeZone } from "../../../../utils/dates.js";
import { AppError } from "../../../../shared/errors/index.js";

export function productEvidenceRow(product) {
  const stock = product.stockBaseQty ?? null;
  const threshold = product.lowStockThreshold ?? null;
  return {
    id: product.id,
    name: product.name,
    unit: product.baseUnit ?? null,
    stockUnit: product.baseUnit ?? null,
    priceUnit: product.rateUnit ?? product.baseUnit ?? null,
    stock,
    tracksStock: product.stockTrackingEnabled !== false,
    price: product.defaultPricePerRateUnit ?? null,
    mrp: product.mrp ?? null,
    lowStockAt: threshold,
    reorderQty: product.reorderLevel ?? null,
    isLow: product.stockTrackingEnabled !== false && stock !== null && Number.isFinite(Number(stock))
      && Number(stock) >= 0 && Number(threshold) > 0 && Number(stock) <= Number(threshold),
  };
}

export function customerEvidenceRow(customer) {
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    udharBalance: customer.udharAmount ?? customer.udharBalance ?? customer.balance ?? null,
    ...(customer.udharAmountPaise !== undefined ? { udharAmountPaise: customer.udharAmountPaise } : {}),
    udharBalanceNeedsRepair: customer.udharBalanceNeedsRepair === true,
  };
}

/** Pick fields deliberately so internal notes and staff-restricted cost never reach the provider. */
export function productDetailEvidence(product, role) {
  const keys = ["id", "name", "baseUnit", "rateUnit", "stockBaseQty", "stockTrackingEnabled", "defaultPricePerRateUnit", "mrp", "hsn", "gstRate", "lowStockThreshold", "reorderLevel", "batchTrackingEnabled", "packagingMode"];
  const canSeeCost = role === "owner" || role === "admin";
  if (canSeeCost) keys.push("costPerRateUnit", "costPerRateUnitPaise");
  const result = Object.fromEntries(keys.filter((key) => Object.hasOwn(product, key)).map((key) => [key, product[key]]));
  const units = (product.sellingUnits ?? []).filter((unit) => unit.isActive !== false);
  result.sellingUnits = units.slice(0, 25).map((unit) => Object.fromEntries([
    "id", "name", "unitCode", "packSizeValue", "packSizeUnit", "conversionToBase", "defaultPrice", "defaultPricePaise", "onHandQty", "isDefault", "barcode",
    ...(canSeeCost ? ["costPrice", "costPricePaise"] : []),
  ].filter((key) => Object.hasOwn(unit, key)).map((key) => [key, unit[key]])));
  result.sellingUnitsTruncated = units.length > 25;
  return result;
}

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/** Translate the assistant's named ranges into the reporting service's date contract. */
export function agentReportRange({ range, from, to } = {}, now = new Date(), timeZone = "Asia/Kolkata") {
  if (from || to) {
    if (!validDate(from) || !validDate(to) || from > to) throw new AppError("Provide valid from and to dates in order", 422, "AI_REPORT_RANGE_INVALID");
    return { from, to };
  }
  const today = formatDateInTimeZone(now, timeZone);
  const [year, month, day] = today.split("-").map(Number);
  const key = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).toISOString().slice(0, 10);
  switch (range ?? "today") {
    case "today": return { from: today, to: today };
    case "yesterday": { const previous = key(year, month, day - 1); return { from: previous, to: previous }; }
    case "week": return { from: key(year, month, day - 6), to: today };
    case "month": return { from: key(year, month, 1), to: today };
    case "quarter": return { from: key(year, Math.floor((month - 1) / 3) * 3 + 1, 1), to: today };
    case "year": return { from: key(year, 1, 1), to: today };
    default: throw new AppError("Unsupported report range", 422, "AI_REPORT_RANGE_INVALID");
  }
}
