import crypto from "crypto";
import db from "../../db.js";
import { env } from "../../config/env.js";
import { AppError } from "../../middleware/error.js";
import { getDateRange } from "../../utils/dates.js";
import { gspHttpReadiness, submitEInvoiceToGsp } from "./gsp-http.provider.js";

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
    { key: "eway", label: "E-way bill transport data", ready: false, detail: "Vehicle, transporter and distance fields are not yet captured" },
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

export async function getGstInvoiceRegister(shopId, query = {}) {
  const { start, end } = getDateRange(query.range === "custom" ? null : query.range, query.from, query.to, env.DAILY_CLOSING_TIMEZONE);
  const bills = await db.bill.findMany({
    where: { shopId, ...(query.locationId && { locationId: query.locationId }), status: "active", billType: { not: "estimate" }, createdAt: { gte: start, lte: end } },
    orderBy: { createdAt: "asc" },
    include: { items: { include: { product: { select: { hsn: true } } } }, payments: true },
  });
  const rows = [];
  for (const bill of bills) {
    for (const item of bill.items) {
      const taxableValue = taxableForLine(item, bill.gstMode);
      const tax = Math.max(0, Number(item.lineTotal) - taxableValue);
      rows.push({
        invoiceNumber: bill.billNo,
        invoiceDate: bill.createdAt.toISOString().slice(0, 10),
        invoiceType: bill.billType,
        customerName: bill.customerName,
        buyerGstin: bill.buyerGstin || "",
        buyerStateCode: bill.buyerStateCode || "",
        hsn: item.product?.hsn || "",
        description: item.name,
        quantity: item.quantity,
        unit: item.enteredUnit,
        gstRate: item.gstRate,
        taxableValue: Number(taxableValue.toFixed(2)),
        cgst: Number((tax / 2).toFixed(2)),
        sgst: Number((tax / 2).toFixed(2)),
        igst: 0,
        lineTotal: item.lineTotal,
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
  const keys = ["invoiceNumber", "invoiceDate", "invoiceType", "customerName", "buyerGstin", "buyerStateCode", "hsn", "description", "quantity", "unit", "gstRate", "taxableValue", "cgst", "sgst", "igst", "lineTotal", "paymentModes"];
  const labels = ["Invoice Number", "Invoice Date", "Invoice Type", "Customer", "Buyer GSTIN", "Buyer State Code", "HSN", "Description", "Quantity", "Unit", "GST Rate", "Taxable Value", "CGST", "SGST", "IGST", "Line Total", "Payment Modes"];
  return [labels.join(","), ...register.rows.map((row) => keys.map((key) => csvCell(row[key])).join(","))].join("\r\n");
}

function canonicalPayload(bill, shop) {
  return {
    schemaVersion: "kiranaos-gst-sandbox-v1",
    seller: { legalName: shop.name, gstin: shop.gstNumber, address: shop.address, city: shop.city },
    invoice: { number: bill.billNo, date: bill.createdAt.toISOString(), type: bill.billType, customerName: bill.customerName, buyerGstin: bill.buyerGstin, buyerStateCode: bill.buyerStateCode, buyerAddress: bill.buyerAddress, taxableValue: bill.subtotal, tax: bill.gst, total: bill.grandTotal },
    items: bill.items.map((item) => ({ name: item.name, hsn: item.product?.hsn || null, quantity: item.quantity, unit: item.enteredUnit, gstRate: item.gstRate, total: item.lineTotal })),
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
      data: { status: "accepted", externalReference: result.irn, acknowledgementNo: result.acknowledgementNo, responseJson: JSON.stringify(result.response), errorMessage: null },
    });
  } catch (error) {
    await db.complianceDocument.update({
      where: { id: document.id },
      data: { status: "failed", responseJson: error?.providerResponse ? JSON.stringify(error.providerResponse) : null, errorMessage: String(error?.message || "GSP submission failed").slice(0, 1000) },
    }).catch(() => {});
    throw error;
  }
}
