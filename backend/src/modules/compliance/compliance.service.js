import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { getDateRange } from "../../utils/dates.js";
import { gspHttpReadiness, submitEInvoiceToGsp, submitEWayBillToGsp } from "./gsp-http.provider.js";
import { createAuditLog } from "../audit/audit.service.js";

const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function validateGstin(value) {
  const gstin = String(value || "").trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { valid: false, normalized: gstin, reason: "GSTIN must be a valid 15-character Indian GST number" };
  }
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const codePoint = GST_CHARS.indexOf(gstin[index]);
    const product = codePoint * ((index % 2) + 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GST_CHARS[(36 - (sum % 36)) % 36];
  if (gstin[14] !== expected) return { valid: false, normalized: gstin, reason: "GSTIN checksum is invalid" };
  return { valid: true, normalized: gstin, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) };
}

export function validateHsn(value) {
  const hsn = String(value || "").trim();
  return { valid: /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(hsn), normalized: hsn };
}

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
  const total = Number(line.lineTotal) || 0;
  const rate = Number(line.gstRate) || 0;
  if (gstMode === "none" || rate <= 0) return total;
  return gstMode === "exclusive" ? total : total / (1 + rate / 100);
}

export function calculateLineTaxBreakdown(line, gstMode, sellerStateCode = "", buyerStateCode = "") {
  const taxableValue = taxableForLine(line, gstMode);
  const rate = Number(line.gstRate) || 0;
  const tax = gstMode === "exclusive"
    ? taxableValue * rate / 100
    : Math.max(0, Number(line.lineTotal) - taxableValue);
  const normalizedBuyerState = String(buyerStateCode || "").padStart(2, "0");
  const placeOfSupply = normalizedBuyerState !== "00" ? normalizedBuyerState : sellerStateCode;
  const interstate = Boolean(placeOfSupply && sellerStateCode && placeOfSupply !== sellerStateCode);
  return {
    taxableValue: Number(taxableValue.toFixed(2)),
    tax: Number(tax.toFixed(2)),
    placeOfSupply,
    supplyType: interstate ? "interstate" : "intrastate",
    cgst: interstate ? 0 : Number((tax / 2).toFixed(2)),
    sgst: interstate ? 0 : Number((tax / 2).toFixed(2)),
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
  let remainingDiscount = Math.min(Math.max(Number(bill.discount ?? 0), 0), grossInvoiceValue);
  const lines = grossLines.map((row, index) => {
    const allocatedDiscount = index === grossLines.length - 1
      ? remainingDiscount
      : Math.min(remainingDiscount, Number((Number(bill.discount ?? 0) * row.tax.lineTotal / Math.max(grossInvoiceValue, 0.01)).toFixed(2)));
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
    where: { shopId, ...(query.locationId && { locationId: query.locationId }), status: "active", billType: { not: "estimate" }, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: "asc" },
    include: { items: { include: { product: { select: { hsn: true } } } }, payments: true },
  })]);
  const sellerStateCode = validateGstin(shop?.gstNumber).stateCode || "";
  const rows = [];
  for (const bill of bills) {
    const snapshot = buildInvoiceTaxSnapshot(bill, sellerStateCode);
    for (const { item, tax, discount, grossLineTotal, netLineTotal } of snapshot.lines) {
      rows.push({
        invoiceNumber: bill.billNo,
        invoiceDate: bill.createdAt.toISOString().slice(0, 10),
        invoiceType: bill.billType,
        customerName: bill.customerName,
        buyerGstin: bill.buyerGstin || "",
        buyerStateCode: bill.buyerStateCode || "",
        sellerStateCode,
        placeOfSupply: tax.placeOfSupply,
        supplyType: tax.supplyType,
        hsn: item.product?.hsn || "",
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
  return { from: start.toISOString(), to: end.toISOString(), invoiceCount: bills.length, rowCount: rows.length, rows };
}

function csvCell(value) {
  const text = String(value ?? "");
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function registerToCsv(register) {
  const keys = ["invoiceNumber", "invoiceDate", "invoiceType", "customerName", "buyerGstin", "sellerStateCode", "placeOfSupply", "supplyType", "hsn", "description", "quantity", "unit", "gstRate", "taxableValue", "cgst", "sgst", "igst", "grossLineTotal", "discount", "lineTotal", "paymentModes"];
  const labels = ["Invoice Number", "Invoice Date", "Invoice Type", "Customer", "Buyer GSTIN", "Seller State", "Place of Supply", "Supply Type", "HSN", "Description", "Quantity", "Unit", "GST Rate", "Taxable Value", "CGST", "SGST", "IGST", "Gross Line Total", "Post-tax Discount", "Net Line Total", "Payment Modes"];
  return [labels.join(","), ...register.rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

export async function getGstr1WorkingPapers(shopId, query = {}) {
  const register = await getGstInvoiceRegister(shopId, query);
  const invoiceMap = new Map();
  const b2csMap = new Map();
  const hsnMap = new Map();
  for (const row of register.rows) {
    if (row.buyerGstin) {
      const invoice = invoiceMap.get(row.invoiceNumber) ?? { invoiceNumber: row.invoiceNumber, invoiceDate: row.invoiceDate, buyerGstin: row.buyerGstin, customerName: row.customerName, placeOfSupply: row.placeOfSupply, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, invoiceValue: 0 };
      for (const key of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "invoiceValue"]) invoice[key] = Number((invoice[key] + Number(key === "invoiceValue" ? row.lineTotal : key === "postTaxDiscount" ? row.discount : row[key])).toFixed(2));
      invoiceMap.set(row.invoiceNumber, invoice);
    } else {
      const key = `${row.placeOfSupply}:${row.gstRate}`;
      const summary = b2csMap.get(key) ?? { placeOfSupply: row.placeOfSupply, gstRate: row.gstRate, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, invoiceValue: 0 };
      for (const field of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "invoiceValue"]) summary[field] = Number((summary[field] + Number(field === "invoiceValue" ? row.lineTotal : field === "postTaxDiscount" ? row.discount : row[field])).toFixed(2));
      b2csMap.set(key, summary);
    }
    const hsnKey = `${row.hsn}:${row.unit}:${row.gstRate}`;
    const hsn = hsnMap.get(hsnKey) ?? { hsn: row.hsn, description: row.description, unit: row.unit, gstRate: row.gstRate, quantity: 0, taxableValue: 0, cgst: 0, sgst: 0, igst: 0, postTaxDiscount: 0, totalValue: 0 };
    hsn.quantity = Number((hsn.quantity + Number(row.quantity)).toFixed(3));
    for (const field of ["taxableValue", "cgst", "sgst", "igst", "postTaxDiscount", "totalValue"]) hsn[field] = Number((hsn[field] + Number(field === "totalValue" ? row.lineTotal : field === "postTaxDiscount" ? row.discount : row[field])).toFixed(2));
    hsnMap.set(hsnKey, hsn);
  }
  return { schemaVersion: "kiranaos-gstr1-working-v1", filingWarning: "Accountant working papers only; review before filing on GSTN", from: register.from, to: register.to, b2b: [...invoiceMap.values()], b2cs: [...b2csMap.values()], hsn: [...hsnMap.values()] };
}

export function gstr1WorkingToCsv(working) {
  const header = ["Section", "Invoice Number", "Invoice Date", "Buyer GSTIN", "Place of Supply", "HSN", "Description", "Unit", "GST Rate", "Quantity", "Taxable Value", "CGST", "SGST", "IGST", "Post-tax Discount", "Invoice/Total Value"];
  const rows = [
    ...working.b2b.map((row) => ["B2B", row.invoiceNumber, row.invoiceDate, row.buyerGstin, row.placeOfSupply, "", row.customerName, "", "", "", row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.invoiceValue]),
    ...working.b2cs.map((row) => ["B2CS", "", "", "", row.placeOfSupply, "", "", "", row.gstRate, "", row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.invoiceValue]),
    ...working.hsn.map((row) => ["HSN", "", "", "", "", row.hsn, row.description, row.unit, row.gstRate, row.quantity, row.taxableValue, row.cgst, row.sgst, row.igst, row.postTaxDiscount, row.totalValue]),
  ];
  return [header.join(","), ...rows.map((row) => row.map(csvCell).join(","))].join("\r\n");
}

function canonicalPayload(bill, shop) {
  const sellerStateCode = validateGstin(shop.gstNumber).stateCode || "";
  const snapshot = buildInvoiceTaxSnapshot(bill, sellerStateCode);
  return {
    schemaVersion: "kiranaos-gst-sandbox-v1",
    seller: { legalName: shop.name, gstin: shop.gstNumber, address: shop.address, city: shop.city },
    invoice: { number: bill.billNo, date: bill.createdAt.toISOString(), type: bill.billType, customerName: bill.customerName, buyerGstin: bill.buyerGstin, buyerStateCode: bill.buyerStateCode, buyerAddress: bill.buyerAddress, taxableValue: snapshot.taxableValue, tax: snapshot.tax, postTaxDiscount: snapshot.discount, grossValue: snapshot.grossInvoiceValue, total: snapshot.netInvoiceValue },
    items: snapshot.lines.map(({ item, tax, discount, grossLineTotal, netLineTotal }) => ({ name: item.name, hsn: item.product?.hsn || null, quantity: item.quantity, unit: item.enteredUnit, gstRate: item.gstRate, taxableValue: tax.taxableValue, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, grossValue: grossLineTotal, postTaxDiscount: discount, total: netLineTotal })),
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
  const missing = bill.items.filter((item) => Number(item.gstRate) > 0 && !validateHsn(item.product?.hsn).valid);
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
  const missing = bill.items.filter((item) => Number(item.gstRate) > 0 && !validateHsn(item.product?.hsn).valid);
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
    invoice: { number: bill.billNo, date: bill.createdAt.toISOString(), type: bill.billType, taxableValue: snapshot.taxableValue, tax: snapshot.tax, postTaxDiscount: snapshot.discount, grossValue: snapshot.grossInvoiceValue, total: snapshot.netInvoiceValue },
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
    items: snapshot.lines.map(({ item, tax, discount, grossLineTotal, netLineTotal }) => ({ name: item.name, hsn: item.product?.hsn || null, quantity: item.quantity, unit: item.enteredUnit, gstRate: item.gstRate, taxableValue: tax.taxableValue, cgst: tax.cgst, sgst: tax.sgst, igst: tax.igst, grossValue: grossLineTotal, postTaxDiscount: discount, total: netLineTotal })),
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
