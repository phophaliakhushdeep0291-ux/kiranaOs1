import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { buildPdf } from "../../lib/documents/pdf.js";
import { getTradeOrder } from "./trade-orders.service.js";
import { formatDateInTimeZone } from "../../utils/dates.js";
import { buildInvoiceTaxSnapshot } from "../../modules/compliance/compliance.service.js";
import { gstStateLabel } from "../../utils/gst.js";
import { exportTaxTreatment } from "./trade-invoices.service.js";
import { round2 } from "../../utils/money.js";

const money = (value, currency = "INR") => `${currency} ${Number(value || 0).toFixed(2)}`;
const dateOnly = (value) => value ? formatDateInTimeZone(new Date(value)) : "-";

async function context(shopId, orderId) {
  const [shop, order] = await Promise.all([db.shop.findUnique({ where: { id: shopId } }), getTradeOrder(shopId, orderId)]);
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  // One product in two packs printed as "Turmeric Powder 300" and "Turmeric
  // Powder 1", so a packer could not tell the pouches from the cartons.
  const unitIds = [...new Set(order.items.map((row) => row.sellingUnitId).filter(Boolean))];
  const [units, customer] = await Promise.all([
    unitIds.length ? db.productSellingUnit.findMany({ where: { shopId, id: { in: unitIds } }, select: { id: true, name: true } }) : [],
    order.customerId ? db.customer.findFirst({ where: { id: order.customerId, shopId }, select: { address: true, gstNumber: true } }) : null,
  ]);
  return { shop, order, customer, packNames: new Map(units.map((unit) => [unit.id, unit.name])) };
}

const shipTo = ({ order, customer }) => order.shippingAddress || order.billingAddress || customer?.address || "Address not recorded";

function commonMeta({ shop, order, customer }) {
  return [
    { label: "Seller", value: shop.name }, { label: "Seller GSTIN", value: shop.gstNumber || "Not registered" },
    { label: "Seller address", value: `${shop.address}, ${shop.city}` }, { label: "Buyer", value: order.customerName },
    { label: "Buyer GSTIN", value: order.customerGstin || customer?.gstNumber || "Unregistered" }, { label: "Buyer PO", value: order.buyerPoNumber || "-" },
    { label: "Order number", value: order.orderNumber }, { label: "Currency", value: order.currencyCode },
  ];
}

function transportLines(order) {
  const dispatch = order.dispatches?.at(-1);
  return [
    `Transporter: ${dispatch?.transporterName || "-"}`, `Vehicle: ${dispatch?.vehicleNumber || "-"}`,
    `LR / AWB: ${dispatch?.lrAwbNumber || "-"}`, `E-way bill: ${dispatch?.ewayBillNumber || "-"}`,
    ...(order.orderType === "export" ? [`Shipping bill: ${dispatch?.shippingBillNumber || "-"} ${dispatch?.shippingBillDate ? `(${dateOnly(dispatch.shippingBillDate)})` : ""}`.trim()] : []),
  ];
}

const itemColumns = [
  { key: "sku", label: "SKU", width: 50 }, { key: "description", label: "Description", width: 175 },
  { key: "hsn", label: "HSN", width: 55 }, { key: "batches", label: "Batch", width: 70 },
  { key: "quantity", label: "Qty", width: 40, align: "right" }, { key: "rate", label: "Rate", width: 55, align: "right" },
  { key: "total", label: "Amount", width: 65, align: "right" },
];

function rows({ order, packNames }) {
  return order.items.map((row) => {
    const pack = packNames.get(row.sellingUnitId);
    return { sku: row.sku || "-", description: pack ? `${row.description} (${pack})` : row.description, hsn: row.hsn || "-", batches: row.allocations.map((a) => a.batchNumber).join(", ") || "-", quantity: Number(row.packedQuantity || row.quantity), rate: Number(row.unitPrice).toFixed(2), total: Number(row.lineTotal).toFixed(2) };
  });
}

export async function buildTradePdf(shopId, orderId, kind) {
  const ctx = await context(shopId, orderId);
  const { shop, order } = ctx;
  const dispatch = order.dispatches?.at(-1);
  const shared = { meta: commonMeta(ctx), footer: "System generated document. Verify statutory and marketplace data before dispatch." };
  if (kind === "packing-list") return buildPdf({ ...shared, title: "PACKING LIST", subtitle: `Dispatch ${dispatch?.dispatchNumber || "pending"} | ${dateOnly(dispatch?.dispatchDate)}`, sections: [{ heading: "Ship to", lines: [shipTo(ctx)] }, { heading: "Packed goods", columns: itemColumns, rows: rows(ctx) }, { heading: "Shipment", lines: [...transportLines(order), `Packages: ${dispatch?.packageCount || "-"}`, `Net weight: ${dispatch?.netWeight || "-"}`, `Gross weight: ${dispatch?.grossWeight || "-"}`, `Container / seal: ${dispatch?.containerNumber || "-"} / ${dispatch?.sealNumber || "-"}`] }] });
  if (kind === "shipping-label") return buildPdf({ ...shared, title: "SHIPPING LABEL", subtitle: "Seller generated - use the marketplace-issued label when platform logistics requires it", meta: [{ label: "Shipment / order", value: dispatch?.lrAwbNumber || order.orderNumber }, { label: "Dispatch", value: dispatch?.dispatchNumber || "pending" }, { label: "Seller", value: shop.name }, { label: "From", value: `${shop.address}, ${shop.city}` }, { label: "Deliver to", value: order.customerName }, { label: "Address", value: shipTo(ctx) }, { label: "Packages", value: String(dispatch?.packageCount || 1) }, { label: "Transporter / vehicle", value: `${dispatch?.transporterName || "-"} / ${dispatch?.vehicleNumber || "-"}` }, { label: "E-way bill", value: dispatch?.ewayBillNumber || "-" }], sections: [{ heading: "Contents", columns: [{ key: "sku", label: "Seller SKU", width: 150 }, { key: "description", label: "Item", width: 260 }, { key: "quantity", label: "Qty", width: 70, align: "right" }], rows: rows(ctx) }, { heading: "Handling", lines: ["Scan/verify shipment ID before handover.", "Keep proof of dispatch and proof of delivery with this order record."] }] });
  if (!["tax-invoice", "commercial-invoice"].includes(kind)) throw new AppError("Unknown trade document", 404, "TRADE_DOCUMENT_UNKNOWN");
  const isExport = order.orderType === "export";
  if (!order.billId) throw new AppError("Create this order's accounting invoice before downloading it", 409, "TRADE_ORDER_INVOICE_REQUIRED");
  const bill = await db.bill.findFirst({ where: { id: order.billId, shopId, status: "active", deletedAt: null }, include: { items: true } });
  if (!bill) throw new AppError("The order's accounting invoice is unavailable", 409, "TRADE_ORDER_INVOICE_REQUIRED");
  const taxInvoice = bill.billType === "gst_invoice";
  // Invoice identity, parties and totals come from the saved accounting record.
  // Order drafts and mutable catalogue/shop settings are not invoice evidence.
  shared.meta = [
    { label: "Seller", value: bill.sellerLegalName || shop.name }, { label: "Seller GSTIN", value: bill.sellerGstin || "Not registered" },
    { label: "Seller address", value: bill.sellerAddress || "-" }, { label: "Buyer", value: bill.customerName },
    { label: "Buyer GSTIN", value: bill.buyerGstin || "Unregistered" }, { label: "Buyer PO", value: order.buyerPoNumber || "-" },
    { label: "Order number", value: order.orderNumber },
    { label: "Currency", value: isExport ? `INR (billed) / ${order.currencyCode} at ${Number(order.exchangeRate).toFixed(4)}` : "INR" },
    // A tax invoice names the place of supply; it is also what decides IGST
    // against CGST + SGST, so the split below and this line cannot disagree.
    ...(taxInvoice ? [{ label: "Place of supply", value: gstStateLabel(bill.buyerStateCode || bill.sellerStateCode) || "-" }] : []),
  ];
  const snapshot = buildInvoiceTaxSnapshot(bill, bill.sellerStateCode || "");
  const interstate = snapshot.lines.some((line) => line.tax.supplyType === "interstate");
  const gst = Number(bill.gst || 0);
  const centralTax = round2(gst / 2);
  const itemSection = taxInvoice
    ? { heading: "Invoice items", columns: [{ key: "description", label: "Item / packaging", width: 170 }, { key: "hsn", label: "HSN", width: 48 }, { key: "quantity", label: "Qty", width: 35, align: "right" }, { key: "rate", label: "Rate", width: 52, align: "right" }, { key: "taxable", label: "Taxable", width: 60, align: "right" }, { key: "gstRate", label: "GST %", width: 32, align: "right" }, { key: "tax", label: interstate ? "IGST" : "CGST+SGST", width: 55, align: "right" }, { key: "total", label: "Total", width: 60, align: "right" }], rows: snapshot.lines.map(({ item, tax, netLineTotal }) => ({ description: `${item.name} (${item.sellingUnitLabel || item.enteredUnit})`, hsn: item.hsn || "-", quantity: item.quantity, rate: Number(item.ratePerRateUnit).toFixed(2), taxable: tax.taxableValue.toFixed(2), gstRate: Number(item.gstRate || 0), tax: tax.tax.toFixed(2), total: netLineTotal.toFixed(2) })) }
    : { heading: "Invoice items", columns: [{ key: "description", label: "Item / packaging", width: 220 }, { key: "hsn", label: "HSN", width: 60 }, { key: "quantity", label: "Qty", width: 60, align: "right" }, { key: "rate", label: "Rate", width: 70, align: "right" }, { key: "total", label: "Amount", width: 80, align: "right" }], rows: bill.items.map(row => ({ description: `${row.name} (${row.sellingUnitLabel || row.enteredUnit})`, hsn: row.hsn || "-", quantity: row.quantity, rate: Number(row.ratePerRateUnit).toFixed(2), total: Number(row.lineTotal).toFixed(2) })) };
  const taxLines = !taxInvoice
    ? [`GST: ${money(gst)}`]
    : interstate ? [`IGST: ${money(gst)}`] : [`CGST: ${money(centralTax)}`, `SGST: ${money(round2(gst - centralTax))}`];
  const exportSection = isExport ? [{
    heading: "Export declaration",
    lines: [
      exportTaxTreatment(order).declaration,
      `Country of destination: ${order.countryOfDestination || "-"}`,
      `Country of origin of goods: ${order.countryOfOrigin || "India"}`,
      `IEC: ${order.iec || "-"}`,
      `Incoterm / price basis: ${order.incoterm || "-"} / ${order.priceBasis || "-"}`,
      `Port of loading: ${order.portOfLoading || "-"}`,
      `Port of discharge: ${order.portOfDischarge || "-"}`,
      `Payment terms: ${order.paymentTerms || "-"}`,
      // The buyer contracted in their own currency; the books are INR. Both
      // figures and the rate between them belong on the document.
      `Order value: ${money(order.items.reduce((sum, row) => sum + Number(row.lineTotal), 0), order.currencyCode)} at ${Number(order.exchangeRate).toFixed(4)} INR`,
    ],
  }] : [];
  return buildPdf({ ...shared, title: isExport ? "EXPORT INVOICE" : taxInvoice ? "TAX INVOICE" : "SALES INVOICE", subtitle: `${bill.billNo} | ${dateOnly(bill.businessDate || bill.createdAt)}`, sections: [
    { heading: "Bill to / ship to", lines: [bill.buyerAddress || bill.customerName, order.shippingAddress || bill.buyerAddress || "Address not recorded"] },
    itemSection,
    ...exportSection,
    { heading: "Totals", lines: [`${taxInvoice ? "Taxable value" : "Subtotal"}: ${money(taxInvoice ? snapshot.taxableValue : bill.subtotal)}`, ...taxLines, `Invoice total: ${money(bill.grandTotal)}`, `Paid: ${money(bill.paidAmount)}`, `Credit recorded: ${money(bill.creditAmount)}`, `Dispatch: ${dispatch?.dispatchNumber || "-"}`, `E-way bill: ${dispatch?.ewayBillNumber || "-"}`, `Vehicle: ${dispatch?.vehicleNumber || "-"}`] },
  ] });
}
