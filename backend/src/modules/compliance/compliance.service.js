import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { getDateRange } from "../../utils/dates.js";
import { gspHttpReadiness, submitEInvoiceToGsp, submitEWayBillToGsp } from "./gsp-http.provider.js";
import { createAuditLog } from "../audit/audit.service.js";
import { validateGstin, validateHsn } from "../../utils/gst.js";

export { validateGstin, validateHsn } from "../../utils/gst.js";

export async function getHsnCategorySummary(shopId) {
  const products = await db.product.findMany({
    where: { shopId, deletedAt: null },
    select: { category: true, hsn: true, gstRate: true },
    orderBy: { category: "asc" },
  });
  const groups = new Map();
  for (const product of products) {
    const key = product.category?.trim() || "__uncategorised__";
    const group = groups.get(key) ?? { category: product.category?.trim() || null, productCount: 0, hsnCodes: new Set(), gstRates: new Set(), missingHsn: 0, invalidHsn: 0 };
    group.productCount += 1;
    if (!product.hsn) group.missingHsn += 1;
    else if (!validateHsn(product.hsn).valid) group.invalidHsn += 1;
    else group.hsnCodes.add(product.hsn);
    group.gstRates.add(Number(product.gstRate ?? 0));
    groups.set(key, group);
  }
  return {
    categories: [...groups.values()].map((group) => ({
      category: group.category,
      label: group.category || "Uncategorised",
      productCount: group.productCount,
      hsn: group.hsnCodes.size === 1 ? [...group.hsnCodes][0] : null,
      gstRate: group.gstRates.size === 1 ? [...group.gstRates][0] : null,
      missingHsn: group.missingHsn,
      invalidHsn: group.invalidHsn,
      consistent: group.hsnCodes.size <= 1 && group.gstRates.size <= 1 && group.missingHsn === 0 && group.invalidHsn === 0,
    })),
  };
}

export async function assignHsnToCategory(shopId, input, actor = {}, req = null) {
  if (!validateHsn(input.hsn).valid) throw new AppError("HSN must contain 4, 6 or 8 digits", 400, "INVALID_HSN");
  const where = { shopId, deletedAt: null, category: input.category };
  const result = await db.product.updateMany({ where, data: { hsn: input.hsn, gstRate: Number(input.gstRate) } });
  if (result.count === 0) throw new AppError("No active products were found in that category", 404, "PRODUCT_CATEGORY_EMPTY");
  await createAuditLog({
    shopId,
    userId: actor.userId,
    action: "HSN_CATEGORY_ASSIGNED",
    entityType: "ProductCategory",
    entityId: input.category || "uncategorised",
    metadata: { category: input.category, hsn: input.hsn, gstRate: Number(input.gstRate), productCount: result.count },
    req,
  });
  return { updatedProducts: result.count, category: input.category, hsn: input.hsn, gstRate: Number(input.gstRate) };
}

export async function getReadiness(shopId) {
  const [shop, taxableProducts, gstInvoiceCount, documentCount] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId }, select: { id: true, name: true, gstNumber: true, city: true, address: true } }),
    db.product.findMany({ where: { shopId, deletedAt: null, gstRate: { gt: 0 } }, select: { id: true, name: true, hsn: true, gstRate: true } }),
    db.bill.count({ where: { shopId, billType: "gst_invoice", status: "active" } }),
    db.complianceDocument.count({ where: { shopId } }),
  ]);
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  const gstin = validateGstin(shop.gstNumber);
  const missingHsn = taxableProducts.filter((row) => !row.hsn);
  const invalidHsn = taxableProducts.filter((row) => row.hsn && !validateHsn(row.hsn).valid);
  const liveProvider = env.GST_PROVIDER === "gsp_http" ? gspHttpReadiness() : {
    mode: env.GST_PROVIDER,
    providerName: env.GST_PROVIDER === "sandbox" ? "KiranaOS sandbox" : null,
    configured: env.GST_PROVIDER === "sandbox",
    certified: false,
    legalSubmission: false,
  };
  const checks = [
    { key: "gstin", label: "Valid shop GSTIN", ready: gstin.valid, detail: gstin.valid ? `State code ${gstin.stateCode}` : gstin.reason },
    { key: "hsn", label: "HSN coverage on taxable products", ready: missingHsn.length === 0 && invalidHsn.length === 0, detail: `${taxableProducts.length - missingHsn.length - invalidHsn.length}/${taxableProducts.length} taxable products valid` },
    { key: "invoice_register", label: "Auditable GST invoice register", ready: true, detail: `${gstInvoiceCount} GST invoices available for export` },
    { key: "provider", label: "Certified GSTN/GSP submission", ready: liveProvider.legalSubmission, detail: liveProvider.legalSubmission ? `${liveProvider.providerName} is configured for legal IRN submission` : liveProvider.configured ? "A non-legal sandbox is enabled, or provider certification is not attested" : "No certified GSP is connected; filing remains blocked by design" },
    { key: "eway", label: "E-way bill transport data", ready: true, detail: "Transporter, vehicle, document, distance and delivery fields are captured with audited draft and GSP submission paths" },
  ];
  return {
    score: Math.round((checks.filter((row) => row.ready).length / checks.length) * 100),
    legallyReady: checks.every((row) => row.ready),
    provider: liveProvider,
    checks,
    gaps: { missingHsn: missingHsn.slice(0, 25), invalidHsn: invalidHsn.slice(0, 25) },
    stats: { taxableProducts: taxableProducts.length, gstInvoices: gstInvoiceCount, complianceDocuments: documentCount },
  };
}

function taxableForLine(line, gstMode) {
  const total = Math.abs(Number(line.lineTotal) || 0);
  const rate = Number(line.gstRate) || 0;
  if (gstMode === "none" || rate <= 0) return total;
  return gstMode === "exclusive" ? total : total / (1 + rate / 100);
}

export function calculateLineTaxBreakdown(line, gstMode, sellerStateCode = "", buyerStateCode = "") {
  const sign = Number(line.lineTotal) < 0 ? -1 : 1;
  const taxableMagnitude = taxableForLine(line, gstMode);
  const rate = Number(line.gstRate) || 0;
  const taxMagnitude = gstMode === "exclusive"
    ? taxableMagnitude * rate / 100
    : Math.max(0, Math.abs(Number(line.lineTotal)) - taxableMagnitude);
  const taxableValue = taxableMagnitude * sign;
  const tax = taxMagnitude * sign;
  const normalizedBuyerState = String(buyerStateCode || "").padStart(2, "0");
  const placeOfSupply = normalizedBuyerState !== "00" ? normalizedBuyerState : sellerStateCode;
  const interstate = Boolean(placeOfSupply && sellerStateCode && placeOfSupply !== sellerStateCode);
  return {
    taxableValue: Number(taxableValue.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    placeOfSupply,
    supplyType: interstate ? "interstate" : "intrastate",
    cgst: interstate ? 0 : Number((tax / 2).toFixed(2)),
    sgst: interstate ? 0 : Number((tax - Number((tax / 2).toFixed(2))).toFixed(2)),
    igst: interstate ? Number(tax.toFixed(2)) : 0,
    lineTotal: Number((taxableValue + tax).toFixed(2)),
  };
}

/**
 * Reconcile invoice-level post-tax concessions across lines without changing the GST liability.
 * The billing engine intentionally treats the counter's bill discount as a post-tax concession;
 * exports must therefore show both gross value and the allocated concession so their net values
 * reconcile exactly to Bill.grandTotal instead of silently overstating the invoice value.
 */
export function buildInvoiceTaxSnapshot(bill, sellerStateCode = "") {
  const grossLines = bill.items.map((item) => ({
    item,
    tax: calculateLineTaxBreakdown(item, bill.gstMode, sellerStateCode, bill.buyerStateCode),
  }));
  const grossInvoiceValue = Number(grossLines.reduce((sum, row) => sum + row.tax.lineTotal, 0).toFixed(2));
  const allocatableGrossValue = Math.max(0, grossInvoiceValue);
  let remainingDiscount = Math.min(Math.max(Number(bill.discount ?? 0), 0), allocatableGrossValue);
  const lines = grossLines.map((row, index) => {
    const allocatedDiscount = index === grossLines.length - 1
      ? remainingDiscount
      : Math.min(remainingDiscount, Number((Number(bill.discount ?? 0) * Math.max(0, row.tax.lineTotal) / Math.max(allocatableGrossValue, 0.01)).toFixed(2)));
    remainingDiscount = Number((remainingDiscount - allocatedDiscount).toFixed(2));
    return {
      ...row,
      grossLineTotal: row.tax.lineTotal,
      discount: Number(allocatedDiscount.toFixed(2)),
      netLineTotal: Number((row.tax.lineTotal - allocatedDiscount).toFixed(2)),
    };
  });
  return {
    lines,
    taxableValue: Number(lines.reduce((sum, row) => sum + row.tax.taxableValue, 0).toFixed(2)),
    tax: Number(lines.reduce((sum, row) => sum + row.tax.tax, 0).toFixed(2)),
    discount: Number(lines.reduce((sum, row) => sum + row.discount, 0).toFixed(2)),
    grossInvoiceValue,
    netInvoiceValue: Number(lines.reduce((sum, row) => sum + row.netLineTotal, 0).toFixed(2)),
  };
}

export async function getGstInvoiceRegister(shopId, query = {}) {
  const { start, end } = getDateRange(query.range === "custom" ? null : query.range, query.from, query.to, env.DAILY_CLOSING_TIMEZONE);
  const [shop, bills] = await Promise.all([db.shop.findUnique({ where: { id: shopId }, select: { gstNumber: true } }), db.bill.findMany({
    where: { shopId, ...(query.locationId && { locationId: query.locationId }), status: "active", billType: { not: "estimate" }, businessDate: { gte: start, lte: end } },
    orderBy: { businessDate: "asc" },
    include: { items: { include: { product: { select: { hsn: true } } } }, payments: true },
  })]);
  const sellerStateCode = validateGstin(shop?.gstNumber).stateCode || "";
  const originalIds = [...new Set(bills.map((bill) => bill.returnOfBillId).filter(Boolean))];
  const originalBills = originalIds.length > 0
    ? await db.bill.findMany({ where: { shopId, id: { in: originalIds } }, select: { id: true, billNo: true, businessDate: true, buyerGstin: true, buyerStateCode: true, buyerAddress: true, customerName: true, grandTotal: true } })
    : [];
  const originalById = new Map(originalBills.map((bill) => [bill.id, bill]));
  const rows = [];
  for (const bill of bills) {
    const original = bill.returnOfBillId ? originalById.get(bill.returnOfBillId) : null;
    const effectiveBill = original ? {
      ...bill,
      buyerGstin: bill.buyerGstin || original.buyerGstin,
      buyerStateCode: bill.buyerStateCode || original.buyerStateCode,
      buyerAddress: bill.buyerAddress || original.buyerAddress,
      customerName: bill.customerName || original.customerName,
    } : bill;
    const snapshot = buildInvoiceTaxSnapshot(effectiveBill, sellerStateCode);
    for (const { item, tax, discount, grossLineTotal, netLineTotal } of snapshot.lines) {
      rows.push({
        invoiceNumber: bill.billNo,
        invoiceDate: bill.businessDate.toISOString().slice(0, 10),
        invoiceType: bill.billType,
        documentType: bill.billType === "sales_return" ? "credit_note" : "invoice",
        originalInvoiceNumber: original?.billNo || "",
        originalInvoiceDate: original?.businessDate?.toISOString().slice(0, 10) || "",
        originalInvoiceValue: Number(original?.grandTotal ?? 0),
        customerName: effectiveBill.customerName,
        buyerGstin: effectiveBill.buyerGstin || "",
        buyerStateCode: effectiveBill.buyerStateCode || "",
        sellerStateCode,
        placeOfSupply: tax.placeOfSupply,
        supplyType: tax.supplyType,
        hsn: item.hsn || item.product?.hsn || "",
        description: item.name,
        quantity: item.quantity,
        unit: item.enteredUnit,
        gstRate: item.gstRate,
        taxableValue: tax.taxableValue,
        cgst: tax.cgst,
        sgst: tax.sgst,
        igst: tax.igst,
        grossLineTotal,
        discount,
        lineTotal: netLineTotal,
        paymentModes: [...new Set(bill.payments.map((payment) => payment.mode))].join("+"),
      });
    }
  }
  // Table 13 needs every document number the shop issued in the period,
  // including the cancelled ones that never reach the rows above.
  const issued = await db.bill.findMany({
    where: { shopId, ...(query.locationId && { locationId: query.locationId }), billType: { not: "estimate" }, businessDate: { gte: start, lte: end } },
    select: { billNo: true, status: true },
    orderBy: { billNo: "asc" },
  });
  const documents = issued.map((bill) => ({ invoiceNumber: bill.billNo, cancelled: bill.status === "cancelled" }));

  return { from: start.toISOString(), to: end.toISOString(), invoiceCount: bills.length, rowCount: rows.length, rows, documents };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function registerToCsv(register) {
  const keys = ["invoiceNumber", "invoiceDate", "invoiceType", "documentType", "originalInvoiceNumber", "originalInvoiceDate", "customerName", "buyerGstin", "sellerStateCode", "placeOfSupply", "supplyType", "hsn", "description", "quantity", "unit", "gstRate", "taxableValue", "cgst", "sgst", "igst", "grossLineTotal", "discount", "lineTotal", "paymentModes"];
  const labels = ["Document Number", "Document Date", "Bill Type", "Document Type", "Original Invoice Number", "Original Invoice Date", "Customer", "Buyer GSTIN", "Seller State", "Place of Supply", "Supply Type", "HSN", "Description", "Quantity", "Unit", "GST Rate", "Taxable Value", "CGST", "SGST", "IGST", "Gross Line Total", "Post-tax Discount", "Net Line Total", "Payment Modes"];
  return [labels.join(","), ...register.rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

/**
 * GSTR-1 Table 12 reports quantities in GSTN's Unit Quantity Codes, not in the
 * free text a counter types. Anything unmapped falls back to OTH ("others"),
 * which the portal accepts, rather than failing the export.
 */
const UQC_BY_UNIT = {
  kg: "KGS", kgs: "KGS", kilogram: "KGS", kilograms: "KGS",
  g: "GMS", gm: "GMS", gms: "GMS", gram: "GMS", grams: "GMS",
  l: "LTR", ltr: "LTR", litre: "LTR", liter: "LTR", litres: "LTR",
  ml: "MLT", mls: "MLT",
  piece: "NOS", pieces: "NOS", pc: "NOS", pcs: "NOS", nos: "NOS", no: "NOS", unit: "NOS", units: "NOS",
  packet: "PAC", packets: "PAC", pack: "PAC", pkt: "PAC", pouch: "PAC",
  box: "BOX", boxes: "BOX", carton: "BOX",
  bag: "BAG", bags: "BAG", sack: "BAG",
  bottle: "BTL", bottles: "BTL", btl: "BTL",
  tin: "TIN", can: "CAN", jar: "JAR", tube: "TUB",
  dozen: "DOZ", doz: "DOZ",
  pair: "PRS", pairs: "PRS",
  bundle: "BDL", roll: "ROL", set: "SET", sheet: "SHT", square_feet: "SQF", metre: "MTR", meter: "MTR",
  quintal: "QTL", tonne: "TON", ton: "TON",
};

export function toUqc(unit) {
  const key = String(unit ?? "").trim().toLowerCase().replace(/\s+/g, "_");
  return UQC_BY_UNIT[key] ?? "OTH";
}

/** Inter-state B2C invoices above this value are reported invoice-wise (B2CL), not summarised. */
const B2CL_INVOICE_VALUE_THRESHOLD = 250000;

const money = (value) => Number((Number(value) || 0).toFixed(2));

function groupRegisterByDocument(register) {
  const documents = new Map();
  for (const row of register.rows) {
    const existing = documents.get(row.invoiceNumber);
    if (existing) {
      existing.rows.push(row);
      existing.invoiceValue = money(existing.invoiceValue + Number(row.lineTotal));
      continue;
    }
    documents.set(row.invoiceNumber, {
      invoiceNumber: row.invoiceNumber,
      invoiceDate: row.invoiceDate,
      documentType: row.documentType,
      buyerGstin: row.buyerGstin,
      customerName: row.customerName,
      placeOfSupply: row.placeOfSupply,
      supplyType: row.supplyType,
      originalInvoiceNumber: row.originalInvoiceNumber,
      originalInvoiceDate: row.originalInvoiceDate,
      originalInvoiceValue: row.originalInvoiceValue,
      invoiceValue: money(row.lineTotal),
      rows: [row],
    });
  }
  return [...documents.values()];
}

/**
 * Table 8 — nil rated, exempted and non-GST outward supplies, split the four
 * ways the return asks for. A kirana sells a large share of 0% goods (atta,
 * milk, salt, fresh produce), so leaving these inside B2CS overstates taxable
 * turnover. Distinguishing "nil rated" from "exempt" from "non-GST" needs a
 * per-item legal classification the catalogue does not carry, so they are
 * reported together and the filing warning says so.
 */
function nilRatedBucketKey(row) {
  const interstate = row.supplyType === "interstate";
  const registered = Boolean(row.buyerGstin);
  if (interstate && registered) return "interstate_registered";
  if (!interstate && registered) return "intrastate_registered";
  if (interstate) return "interstate_unregistered";
  return "intrastate_unregistered";
}

const NIL_BUCKET_LABELS = {
  interstate_registered: "Inter-State supplies to registered persons",
  intrastate_registered: "Intra-State supplies to registered persons",
  interstate_unregistered: "Inter-State supplies to unregistered persons",
  intrastate_unregistered: "Intra-State supplies to unregistered persons",
};

export function buildGstr1WorkingFromRegister(register) {
  const invoiceMap = new Map();
  const b2clMap = new Map();
  const b2csMap = new Map();
  const cdnrMap = new Map();
  const cdnurMap = new Map();
  const hsnMap = new Map();
  const nilMap = new Map();

  const documents = groupRegisterByDocument(register);
  const b2clInvoiceNumbers = new Set(
    documents
      .filter((doc) => doc.documentType !== "credit_note"
        && !doc.buyerGstin
        && doc.supplyType === "interstate"
        && Math.abs(doc.invoiceValue) > B2CL_INVOICE_VALUE_THRESHOLD)
      .map((doc) => doc.invoiceNumber)
  );

  for (const row of register.rows) {
    const isCreditNote = row.documentType === "credit_note";
    const isNilRated = Number(row.gstRate) === 0;

    // Nil rated / exempt supplies are a separate disclosure (Table 8) and must
    // not inflate the taxable B2CS summary.
    if (isNilRated && !isCreditNote) {
      const key = nilRatedBucketKey(row);
      const bucket = nilMap.get(key) ?? { key, label: NIL_BUCKET_LABELS[key], nilRatedOrExempt: 0, nonGst: 0 };
      bucket.nilRatedOrExempt = money(bucket.nilRatedOrExempt + Number(row.lineTotal));
      nilMap.set(key, bucket);
    }

    const cdnurEligible = isCreditNote && !row.buyerGstin && row.supplyType === "interstate" && Math.abs(Number(row.originalInvoiceValue ?? 0)) > 100000;
    if (isCreditNote && (row.buyerGstin || cdnurEligible)) {
      const targetMap = row.buyerGstin ? cdnrMap : cdnurMap;
      const note = targetMap.get(row.invoiceNumber) ?? {
        noteNumber: row.invoiceNumber,
        noteDate: row.invoiceDate,
        noteType: "C",
        buyerGstin: row.buyerGstin,
        customerName: row.customerName,
        placeOfSupply: row.placeOfSupply,
        originalInvoiceNumber: row.originalInvoiceNumber,
        originalInvoiceDate: row.originalInvoiceDate,
        taxableValue: 0,
        cgst: 0,
        sgst: 0,
        igst: 0,
        noteValue: 0,
      };
      for (const key of ["taxableValue", "cgst", "sgst", "igst", "noteValue"]) {
        const source = key === "noteValue" ? row.lineTotal : row[key];
        note[key] = Number((note[key] + Math.abs(Number(source))).toFixed(2));
      }
      targetMap.set(row.invoiceNumber, note);
    } else if (row.buyerGstin && !isCreditNote) {
      const invoice = invoiceMap.get(row.invoiceNumber) ?? { invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, buyerGstin: row.buyerGstin, customerName: row.customerName, placeOfSupply: row.placeOfSupply, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, invoiceValue: 0 };
      for (const key of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "invoiceValue"]) invoice[key] = Number((invoice[key] + Number(key === "invoiceValue" ? row.lineTotal : key === "postTaxDiscount" ? row.discount : row[key])).toFixed(2));
      invoiceMap.set(row.invoiceNumber, invoice);
    } else if (!row.buyerGstin && b2clInvoiceNumbers.has(row.invoiceNumber)) {
      // Table 5 — inter-State supplies to unregistered persons above the
      // threshold are reported invoice-wise, not netted into B2CS.
      const invoice = b2clMap.get(row.invoiceNumber) ?? { invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, customerName: row.customerName, placeOfSupply: row.placeOfSupply, gstRate: row.gstRate, taxableValue: 0, igst: 0, postTaxDiscount: 0, invoiceValue: 0 };
      for (const field of ["taxableValue", "igst", "postTaxDiscount", "invoiceValue"]) invoice[field] = Number((invoice[field] + Number(field === "invoiceValue" ? row.lineTotal : field === "postTaxDiscount" ? row.discount : row[field])).toFixed(2));
      b2clMap.set(row.invoiceNumber, invoice);
    } else if (!row.buyerGstin && !isNilRated) {
      const key = `${row.placeOfSupply}:${row.gstRate}`;
      const summary = b2csMap.get(key) ?? { placeOfSupply: row.placeOfSupply, gstRate: row.gstRate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, invoiceValue: 0 };
      for (const field of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "invoiceValue"]) summary[field] = Number((summary[field] + Number(field === "invoiceValue" ? row.lineTotal : field === "postTaxDiscount" ? row.discount : row[field])).toFixed(2));
      b2csMap.set(key, summary);
    }
    const hsnKey = `${row.hsn}:${row.unit}:${row.gstRate}`;
    const hsn = hsnMap.get(hsnKey) ?? { hsn: row.hsn, description: row.description, unit: row.unit, uqc: toUqc(row.unit), gstRate: row.gstRate, quantity: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, totalValue: 0 };
    hsn.quantity = Number((hsn.quantity + Number(row.quantity)).toFixed(3));
    for (const field of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "totalValue"]) hsn[field] = Number((hsn[field] + Number(field === "totalValue" ? row.lineTotal : field === "postTaxDiscount" ? row.discount : row[field])).toFixed(2));
    hsnMap.set(hsnKey, hsn);
  }
  return {
    schemaVersion: "artha-gstr1-working-v3",
    filingWarning: "Accountant working papers only; review GSTN classification before filing. Registered credit notes are separated as CDNR; eligible large interstate unregistered notes as CDNUR; smaller B2C returns are netted into B2CS. Table 8 groups nil-rated and exempt supplies together — splitting nil / exempt / non-GST needs a per-item legal classification the catalogue does not carry.",
    from: register.from,
    to: register.to,
    b2b: [...invoiceMap.values()],
    b2cl: [...b2clMap.values()],
    b2cs: [...b2csMap.values()],
    cdnr: [...cdnrMap.values()],
    cdnur: [...cdnurMap.values()],
    nilRated: [...nilMap.values()],
    hsn: [...hsnMap.values()],
    documentSeries: buildDocumentSeries(register),
  };
}

/**
 * Table 13 — the series of documents issued in the period. Cancelled bills keep
 * their number, so the range has to be built from every document the shop
 * issued, not just the ones that survived.
 */
export function buildDocumentSeries(register) {
  const series = new Map();
  for (const document of [...(register.documents ?? []), ...groupRegisterByDocument(register)]) {
    const prefix = String(document.invoiceNumber ?? "").replace(/\d+$/, "");
    const entry = series.get(prefix) ?? { prefix, from: null, to: null, totalIssued: 0, cancelled: 0, seen: new Set() };
    if (entry.seen.has(document.invoiceNumber)) continue;
    entry.seen.add(document.invoiceNumber);
    entry.totalIssued += 1;
    if (document.cancelled) entry.cancelled += 1;
    if (!entry.from || document.invoiceNumber < entry.from) entry.from = document.invoiceNumber;
    if (!entry.to || document.invoiceNumber > entry.to) entry.to = document.invoiceNumber;
    series.set(prefix, entry);
  }
  return [...series.values()].map(({ seen, ...entry }) => ({ ...entry, net: entry.totalIssued - entry.cancelled }));
}

/**
 * GSTR-3B working summary. Only the outward-supply side is derivable from POS
 * data: input tax credit (Table 4) comes from purchase invoices the shop's
 * accountant reconciles against GSTR-2B, so it is deliberately not guessed here.
 */
export function buildGstr3bFromRegister(register) {
  const outward = { taxableValue: 0, igst: 0, cgst: 0, sgst: 0 };
  const nilRatedExempt = { value: 0 };
  const nonGst = { value: 0 };
  const interStateUnregistered = new Map();

  for (const row of register.rows) {
    const isNilRated = Number(row.gstRate) === 0;
    if (isNilRated) {
      nilRatedExempt.value = money(nilRatedExempt.value + Number(row.lineTotal));
      continue;
    }
    // Credit notes carry negative values, so returns reduce the liability here.
    outward.taxableValue = money(outward.taxableValue + Number(row.taxableValue));
    outward.igst = money(outward.igst + Number(row.igst));
    outward.cgst = money(outward.cgst + Number(row.cgst));
    outward.sgst = money(outward.sgst + Number(row.sgst));

    if (row.supplyType === "interstate" && !row.buyerGstin) {
      const entry = interStateUnregistered.get(row.placeOfSupply) ?? { placeOfSupply: row.placeOfSupply, taxableValue: 0, igst: 0 };
      entry.taxableValue = money(entry.taxableValue + Number(row.taxableValue));
      entry.igst = money(entry.igst + Number(row.igst));
      interStateUnregistered.set(row.placeOfSupply, entry);
    }
  }

  return {
    schemaVersion: "artha-gstr3b-working-v1",
    filingWarning: "Outward supplies only. Input tax credit (Table 4) must be reconciled against GSTR-2B from purchase invoices and is intentionally not derived from POS data.",
    from: register.from,
    to: register.to,
    outwardSupplies: {
      "3.1(a)": { label: "Outward taxable supplies (other than zero rated, nil rated and exempted)", ...outward },
      "3.1(b)": { label: "Outward taxable supplies (zero rated)", taxableValue: 0, igst: 0, cgst: 0, sgst: 0 },
      "3.1(c)": { label: "Other outward supplies (nil rated, exempted)", taxableValue: nilRatedExempt.value, igst: 0, cgst: 0, sgst: 0 },
      "3.1(e)": { label: "Non-GST outward supplies", taxableValue: nonGst.value, igst: 0, cgst: 0, sgst: 0 },
    },
    interStateSuppliesToUnregistered: [...interStateUnregistered.values()],
    taxPayable: {
      igst: outward.igst,
      cgst: outward.cgst,
      sgst: outward.sgst,
      total: money(outward.igst + outward.cgst + outward.sgst),
    },
  };
}

export async function getGstr1WorkingPapers(shopId, query = {}) {
  return buildGstr1WorkingFromRegister(await getGstInvoiceRegister(shopId, query));
}

export async function getGstr3bWorkingPapers(shopId, query = {}) {
  return buildGstr3bFromRegister(await getGstInvoiceRegister(shopId, query));
}

export function gstr1WorkingToCsv(working) {
  const header = ["Section", "Document Number", "Document Date", "Buyer GSTIN", "Place of Supply", "Original Invoice Number", "Original Invoice Date", "HSN", "Description", "Unit", "UQC", "GST Rate", "Quantity", "Taxable Value", "CGST", "SGST", "IGST", "Post-tax Discount", "Invoice/Note Value"];
  const rows = [
    ...working.b2b.map((row) => ["B2B", row.invoiceNumber, row.invoiceDate, row.buyerGstin, row.placeOfSupply, "", "", "", row.customerName, "", "", "", "", row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.invoiceValue]),
    ...(working.b2cl ?? []).map((row) => ["B2CL", row.invoiceNumber, row.invoiceDate, "", row.placeOfSupply, "", "", "", row.customerName, "", "", row.gstRate, "", row.taxableValue, "", "", row.igst, row.postTaxDiscount, row.invoiceValue]),
    ...working.b2cs.map((row) => ["B2CS", "", "", "", row.placeOfSupply, "", "", "", "", "", "", row.gstRate, "", row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.invoiceValue]),
    ...(working.cdnr ?? []).map((row) => ["CDNR", row.noteNumber, row.noteDate, row.buyerGstin, row.placeOfSupply, row.originalInvoiceNumber, row.originalInvoiceDate, "", row.customerName, "", "", "", "", row.taxableValue, row.cgst, row.sgst, row.igst, "", row.noteValue]),
    ...(working.cdnur ?? []).map((row) => ["CDNUR", row.noteNumber, row.noteDate, "", row.placeOfSupply, row.originalInvoiceNumber, row.originalInvoiceDate, "", row.customerName, "", "", "", "", row.taxableValue, row.cgst, row.sgst, row.igst, "", row.noteValue]),
    ...(working.nilRated ?? []).map((row) => ["NIL/EXEMPT", "", "", "", "", "", "", "", row.label, "", "", "", "", row.nilRatedOrExempt, "", "", "", "", row.nilRatedOrExempt]),
    ...working.hsn.map((row) => ["HSN", "", "", "", "", "", "", row.hsn, row.description, row.unit, row.uqc, row.gstRate, row.quantity, row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.totalValue]),
    ...(working.documentSeries ?? []).map((row) => ["DOC-SERIES", `${row.from} - ${row.to}`, "", "", "", "", "", "", `${row.totalIssued} issued, ${row.cancelled} cancelled`, "", "", "", row.net, "", "", "", "", "", ""]),
  ];
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

function canonicalPayload(bill, shop) {
  const sellerStateCode = validateGstin(shop.gstNumber).stateCode || "";
  const snapshot = buildInvoiceTaxSnapshot(bill, sellerStateCode);
  return {
    schemaVersion: "kiranaos-gst-sandbox-v1",
    seller: { legalName: shop.name, gstin: shop.gstNumber, address: shop.address, city: shop.city },
    invoice: { number: bill.billNo, date: bill.businessDate.toISOString(), type: bill.billType, documentType: bill.billType === "sales_return" ? "credit_note" : "invoice", documentTypeCode: bill.billType === "sales_return" ? "CRN" : "INV", originalInvoiceId: bill.returnOfBillId ?? null, customerName: bill.customerName, buyerGstin: bill.buyerGstin, buyerStateCode: bill.buyerStateCode, buyerAddress: bill.buyerAddress, taxableValue: snapshot.taxableValue, tax: snapshot.tax, postTaxDiscount: snapshot.discount, grossValue: snapshot.grossInvoiceValue, total: snapshot.netInvoiceValue },
    items: snapshot.lines.map(({ item, tax, discount, grossLineTotal, netLineTotal }) => ({ name: item.name, hsn: item.hsn || item.product?.hsn || null, quantity: item.quantity, unit: item.enteredUnit, gstRate: item.gstRate, taxableValue: tax.taxableValue, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, grossValue: grossLineTotal, postTaxDiscount: discount, total: netLineTotal })),
  };
}

export async function createSandboxEInvoice(shopId, billId) {
  if (env.GST_PROVIDER !== "sandbox") throw new AppError("GST sandbox provider is not enabled", 503, "GST_PROVIDER_NOT_CONFIGURED");
  const [shop, bill] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId } }),
    db.bill.findFirst({ where: { id: billId, shopId, status: "active" }, include: { items: { include: { product: { select: { hsn: true } } } } } }),
  ]);
  if (!bill) throw new AppError("Bill not found", 404, "BILL_NOT_FOUND");
  if (bill.billType !== "gst_invoice") throw new AppError("Only GST invoices can be prepared for e-invoice submission", 409, "GST_INVOICE_REQUIRED");
  const gstin = validateGstin(shop?.gstNumber);
  if (!gstin.valid) throw new AppError(gstin.reason, 422, "INVALID_SHOP_GSTIN");
  const missing = bill.items.filter((item) => Number(item.gstRate) > 0 && !validateHsn(item.hsn || item.product?.hsn).valid);
  if (missing.length) throw new AppError("Every taxable invoice item needs a valid 4, 6 or 8 digit HSN", 422, "INVOICE_HSN_INCOMPLETE");
  const payload = canonicalPayload(bill, shop);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const externalReference = `SANDBOX-${crypto.randomUUID()}`;
  return db.complianceDocument.upsert({
    where: { billId_documentType: { billId, documentType: "e_invoice" } },
    create: { shopId, billId, documentType: "e_invoice", provider: "sandbox", status: "sandbox_only", externalReference, payloadHash, payloadJson, responseJson: JSON.stringify({ warning: "Not submitted to GSTN; not a legal IRN" }) },
    update: { provider: "sandbox", status: "sandbox_only", externalReference, payloadHash, payloadJson, responseJson: JSON.stringify({ warning: "Not submitted to GSTN; not a legal IRN" }), errorMessage: null },
  });
}

async function loadValidatedInvoice(shopId, billId) {
  const [shop, bill] = await Promise.all([
    db.shop.findUnique({ where: { id: shopId } }),
    db.bill.findFirst({ where: { id: billId, shopId, status: "active" }, include: { items: { include: { product: { select: { hsn: true } } } } } }),
  ]);
  if (!bill) throw new AppError("Bill not found", 404, "BILL_NOT_FOUND");
  if (bill.billType !== "gst_invoice") throw new AppError("Only GST invoices can be submitted", 409, "GST_INVOICE_REQUIRED");
  const gstin = validateGstin(shop?.gstNumber);
  if (!gstin.valid) throw new AppError(gstin.reason, 422, "INVALID_SHOP_GSTIN");
  const missing = bill.items.filter((item) => Number(item.gstRate) > 0 && !validateHsn(item.hsn || item.product?.hsn).valid);
  if (missing.length) throw new AppError("Every taxable invoice item needs a valid 4, 6 or 8 digit HSN", 422, "INVOICE_HSN_INCOMPLETE");
  return { shop, bill };
}

export async function submitEInvoice(shopId, billId) {
  if (env.GST_PROVIDER !== "gsp_http") throw new AppError("Certified GSP submission is not configured", 503, "GST_LEGAL_PROVIDER_NOT_READY");
  const { shop, bill } = await loadValidatedInvoice(shopId, billId);
  const payload = canonicalPayload(bill, shop);
  payload.schemaVersion = "kiranaos-gst-provider-v1";
  const payloadJson = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const existing = await db.complianceDocument.findUnique({ where: { billId_documentType: { billId, documentType: "e_invoice" } } });
  if (existing?.status === "accepted" && existing.externalReference) return existing;
  if (["submitting", "submitted"].includes(existing?.status)) throw new AppError("This invoice submission is already in progress", 409, "GST_SUBMISSION_IN_PROGRESS");

  let document;
  if (existing) {
    const claimed = await db.complianceDocument.updateMany({
      where: { id: existing.id, status: existing.status },
      data: { provider: env.GST_PROVIDER_LEGAL_NAME, status: "submitting", payloadHash, payloadJson, errorMessage: null },
    });
    if (claimed.count !== 1) throw new AppError("This invoice submission is already in progress", 409, "GST_SUBMISSION_IN_PROGRESS");
    document = await db.complianceDocument.findUnique({ where: { id: existing.id } });
  } else {
    try {
      document = await db.complianceDocument.create({
        data: { shopId, billId, documentType: "e_invoice", provider: env.GST_PROVIDER_LEGAL_NAME, status: "submitting", payloadHash, payloadJson },
      });
    } catch (error) {
      if (error?.code === "P2002") throw new AppError("This invoice submission is already in progress", 409, "GST_SUBMISSION_IN_PROGRESS");
      throw error;
    }
  }

  try {
    const result = await submitEInvoiceToGsp(payload, { idempotencyKey: `e-invoice:${shopId}:${billId}` });
    return await db.complianceDocument.update({
      where: { id: document.id },
      data: { status: "accepted", externalReference: result.externalReference, acknowledgementNo: result.acknowledgementNo, responseJson: JSON.stringify(result.response), errorMessage: null },
    });
  } catch (error) {
    await db.complianceDocument.update({
      where: { id: document.id },
      data: { status: "failed", responseJson: error?.providerResponse ? JSON.stringify(error.providerResponse) : null, errorMessage: String(error?.message || "GSP submission failed").slice(0, 1000) },
    }).catch(() => {});
    throw error;
  }
}

function canonicalEWayPayload(bill, shop, transport) {
  const sellerStateCode = validateGstin(shop.gstNumber).stateCode || "";
  const snapshot = buildInvoiceTaxSnapshot(bill, sellerStateCode);
  return {
    schemaVersion: "kiranaos-eway-provider-v1",
    supplyType: "outward",
    seller: { legalName: shop.name, gstin: shop.gstNumber, address: shop.address, city: shop.city },
    buyer: { name: bill.customerName, gstin: bill.buyerGstin, stateCode: bill.buyerStateCode, address: bill.buyerAddress },
    invoice: { number: bill.billNo, date: bill.businessDate.toISOString(), type: bill.billType, taxableValue: snapshot.taxableValue, tax: snapshot.tax, postTaxDiscount: snapshot.discount, grossValue: snapshot.grossInvoiceValue, total: snapshot.netInvoiceValue },
    transport: {
      mode: transport.transportMode,
      transporterId: transport.transporterId || null,
      transporterName: transport.transporterName || null,
      vehicleNumber: transport.vehicleNumber ? transport.vehicleNumber.toUpperCase().replaceAll(" ", "") : null,
      vehicleType: transport.vehicleType,
      distanceKm: transport.distanceKm,
      documentNumber: transport.transportDocumentNumber || null,
      documentDate: transport.transportDocumentDate || null,
      deliveryAddress: transport.deliveryAddress,
    },
    items: snapshot.lines.map(({ item, tax, discount, grossLineTotal, netLineTotal }) => ({ name: item.name, hsn: item.hsn || item.product?.hsn || null, quantity: item.quantity, unit: item.enteredUnit, gstRate: item.gstRate, taxableValue: tax.taxableValue, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, grossValue: grossLineTotal, postTaxDiscount: discount, total: netLineTotal })),
  };
}

async function buildEWayPayload(shopId, billId, transport) {
  const { shop, bill } = await loadValidatedInvoice(shopId, billId);
  return canonicalEWayPayload(bill, shop, transport);
}

export async function createEWayBillDraft(shopId, billId, transport) {
  const payload = await buildEWayPayload(shopId, billId, transport);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const externalReference = `DRAFT-${crypto.randomUUID()}`;
  const existing = await db.complianceDocument.findUnique({ where: { billId_documentType: { billId, documentType: "e_way_bill" } } });
  if (["submitting", "submitted"].includes(existing?.status)) {
    throw new AppError("This e-way bill submission is already in progress", 409, "GST_SUBMISSION_IN_PROGRESS");
  }
  if (existing?.status === "accepted" && existing.externalReference && !existing.externalReference.startsWith("DRAFT-")) {
    throw new AppError("A legal e-way bill already exists for this invoice", 409, "EWAY_BILL_ALREADY_ACCEPTED");
  }
  return db.complianceDocument.upsert({
    where: { billId_documentType: { billId, documentType: "e_way_bill" } },
    create: { shopId, billId, documentType: "e_way_bill", provider: "kiranaos_draft", status: "sandbox_only", externalReference, payloadHash, payloadJson, responseJson: JSON.stringify({ warning: "Transport record only; no legal e-way bill number was created" }) },
    update: { provider: "kiranaos_draft", status: "sandbox_only", externalReference, acknowledgementNo: null, payloadHash, payloadJson, responseJson: JSON.stringify({ warning: "Transport record only; no legal e-way bill number was created" }), errorMessage: null },
  });
}

export async function submitEWayBill(shopId, billId, transport) {
  if (env.GST_PROVIDER !== "gsp_http") throw new AppError("Certified GSP submission is not configured", 503, "GST_LEGAL_PROVIDER_NOT_READY");
  const payload = await buildEWayPayload(shopId, billId, transport);
  const payloadJson = JSON.stringify(payload);
  const payloadHash = crypto.createHash("sha256").update(payloadJson).digest("hex");
  const existing = await db.complianceDocument.findUnique({ where: { billId_documentType: { billId, documentType: "e_way_bill" } } });
  if (existing?.status === "accepted" && existing.externalReference && !existing.externalReference.startsWith("DRAFT-")) return existing;
  if (["submitting", "submitted"].includes(existing?.status)) throw new AppError("This e-way bill submission is already in progress", 409, "GST_SUBMISSION_IN_PROGRESS");
  const document = await db.complianceDocument.upsert({
    where: { billId_documentType: { billId, documentType: "e_way_bill" } },
    create: { shopId, billId, documentType: "e_way_bill", provider: env.GST_PROVIDER_LEGAL_NAME, status: "submitting", payloadHash, payloadJson },
    update: { provider: env.GST_PROVIDER_LEGAL_NAME, status: "submitting", payloadHash, payloadJson, errorMessage: null },
  });
  try {
    const result = await submitEWayBillToGsp(payload, { idempotencyKey: `e-way-bill:${shopId}:${billId}` });
    return await db.complianceDocument.update({
      where: { id: document.id },
      data: { status: "accepted", externalReference: result.externalReference, acknowledgementNo: result.acknowledgementNo, responseJson: JSON.stringify(result.response), errorMessage: null },
    });
  } catch (error) {
    await db.complianceDocument.update({
      where: { id: document.id },
      data: { status: "failed", responseJson: error?.providerResponse ? JSON.stringify(error.providerResponse) : null, errorMessage: String(error?.message || "GSP submission failed").slice(0, 1000) },
    }).catch(() => {});
    throw error;
  }
}
