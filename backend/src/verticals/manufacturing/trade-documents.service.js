import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { buildPdf } from "../../lib/documents/pdf.js";
import { getTradeOrder } from "./trade-orders.service.js";
import { formatDateInTimeZone } from "../../utils/dates.js";

const money = (value, currency = "INR") => `${currency} ${Number(value || 0).toFixed(2)}`;
const dateOnly = (value) => value ? formatDateInTimeZone(new Date(value)) : "-";

async function context(shopId, orderId) {
  const [shop, order] = await Promise.all([db.shop.findUnique({ where: { id: shopId } }), getTradeOrder(shopId, orderId)]);
  if (!shop) throw new AppError("Shop not found", 404, "SHOP_NOT_FOUND");
  const subtotal = order.items.reduce((sum, row) => sum + Number(row.lineTotal), 0);
  const gst = order.orderType === "domestic" ? order.items.reduce((sum, row) => sum + Number(row.lineTotal) * Number(row.gstRate) / 100, 0) : 0;
  return { shop, order, subtotal, gst, total: subtotal + gst };
}

function commonMeta({ shop, order }) {
  return [
    { label: "Seller", value: shop.name }, { label: "Seller GSTIN", value: shop.gstNumber || "Not registered" },
    { label: "Seller address", value: `${shop.address}, ${shop.city}` }, { label: "Buyer", value: order.customerName },
    { label: "Buyer GSTIN", value: order.customerGstin || "Unregistered" }, { label: "Buyer PO", value: order.buyerPoNumber || "-" },
    { label: "Order number", value: order.orderNumber }, { label: "Currency", value: order.currencyCode },
  ];
}

const itemColumns = [
  { key: "sku", label: "SKU", width: 70 }, { key: "description", label: "Description", width: 150 },
  { key: "hsn", label: "HSN", width: 55 }, { key: "batches", label: "Batch", width: 75 },
  { key: "quantity", label: "Qty", width: 45, align: "right" }, { key: "rate", label: "Rate", width: 55, align: "right" },
  { key: "total", label: "Amount", width: 65, align: "right" },
];

function rows(order) {
  return order.items.map((row) => ({ sku: row.sku || "-", description: row.description, hsn: row.hsn || "-", batches: row.allocations.map((a) => a.batchNumber).join(", ") || "-", quantity: Number(row.packedQuantity || row.quantity), rate: Number(row.unitPrice).toFixed(2), total: Number(row.lineTotal).toFixed(2) }));
}

export async function buildTradePdf(shopId, orderId, kind) {
  const ctx = await context(shopId, orderId);
  const { shop, order, subtotal, gst, total } = ctx;
  const dispatch = order.dispatch;
  const shared = { meta: commonMeta(ctx), footer: "System generated document. Verify statutory and marketplace data before dispatch." };
  if (kind === "packing-list") return buildPdf({ ...shared, title: "PACKING LIST", subtitle: `Dispatch ${dispatch?.dispatchNumber || "pending"} | ${dateOnly(dispatch?.dispatchDate)}`, sections: [{ heading: "Ship to", lines: [order.shippingAddress || order.billingAddress || "Address not recorded"] }, { heading: "Packed goods", columns: itemColumns, rows: rows(order) }, { heading: "Shipment", lines: [`Packages: ${dispatch?.packageCount || "-"}`, `Net weight: ${dispatch?.netWeight || "-"}`, `Gross weight: ${dispatch?.grossWeight || "-"}`, `Container / seal: ${dispatch?.containerNumber || "-"} / ${dispatch?.sealNumber || "-"}`] }] });
  if (kind === "shipping-label") return buildPdf({ ...shared, title: "MARKETPLACE SHIPPING LABEL", subtitle: "Seller generated - use the marketplace-issued label when platform logistics requires it", meta: [{ label: "Shipment / order", value: dispatch?.lrAwbNumber || order.orderNumber }, { label: "Dispatch", value: dispatch?.dispatchNumber || "pending" }, { label: "Seller", value: shop.name }, { label: "From", value: `${shop.address}, ${shop.city}` }, { label: "Deliver to", value: order.customerName }, { label: "Address", value: order.shippingAddress || order.billingAddress || "Address not recorded" }, { label: "Packages", value: String(dispatch?.packageCount || 1) }], sections: [{ heading: "Contents", columns: [{ key: "sku", label: "Seller SKU", width: 150 }, { key: "description", label: "Item", width: 260 }, { key: "quantity", label: "Qty", width: 70, align: "right" }], rows: rows(order) }, { heading: "Handling", lines: ["Scan/verify shipment ID before handover.", "Keep proof of dispatch and proof of delivery with this order record."] }] });
  if (!["tax-invoice", "commercial-invoice"].includes(kind)) throw new AppError("Unknown trade document", 404, "TRADE_DOCUMENT_UNKNOWN");
  if (!order.billId) throw new AppError("Create this order's accounting invoice before downloading it", 409, "TRADE_ORDER_INVOICE_REQUIRED");
  const bill = await db.bill.findFirst({ where: { id: order.billId, shopId, status: "active", deletedAt: null }, include: { items: true } });
  if (!bill) throw new AppError("The order's accounting invoice is unavailable", 409, "TRADE_ORDER_INVOICE_REQUIRED");
  // Invoice identity, parties and totals come from the saved accounting record.
  // Order drafts and mutable catalogue/shop settings are not invoice evidence.
  shared.meta = [
    { label: "Seller", value: bill.sellerLegalName || shop.name }, { label: "Seller GSTIN", value: bill.sellerGstin || "Not registered" },
    { label: "Seller address", value: bill.sellerAddress || "-" }, { label: "Buyer", value: bill.customerName },
    { label: "Buyer GSTIN", value: bill.buyerGstin || "Unregistered" }, { label: "Buyer PO", value: order.buyerPoNumber || "-" },
    { label: "Order number", value: order.orderNumber }, { label: "Currency", value: "INR" },
  ];
  if (order.orderType === "domestic") return buildPdf({ ...shared, title: bill.billType === "gst_invoice" ? "TAX INVOICE" : "SALES INVOICE", subtitle: `${bill.billNo} | ${dateOnly(bill.businessDate || bill.createdAt)}`, sections: [
    { heading: "Bill to / ship to", lines: [bill.buyerAddress || bill.customerName, order.shippingAddress || bill.buyerAddress || "Address not recorded"] },
    { heading: "Invoice items", columns: [{ key: "description", label: "Item / packaging", width: 220 }, { key: "hsn", label: "HSN", width: 60 }, { key: "quantity", label: "Qty", width: 60, align: "right" }, { key: "rate", label: "Rate", width: 70, align: "right" }, { key: "total", label: "Amount", width: 80, align: "right" }], rows: bill.items.map(row => ({ description: `${row.name} (${row.sellingUnitLabel || row.enteredUnit})`, hsn: row.hsn || "-", quantity: row.quantity, rate: Number(row.ratePerRateUnit).toFixed(2), total: Number(row.lineTotal).toFixed(2) })) },
    { heading: "Totals", lines: [`Subtotal: ${money(bill.subtotal)}`, `GST: ${money(bill.gst)}`, `Invoice total: ${money(bill.grandTotal)}`, `Paid: ${money(bill.paidAmount)}`, `Credit recorded: ${money(bill.creditAmount)}`, `Dispatch: ${dispatch?.dispatchNumber || "-"}`] },
  ] });
  const exportLines = order.orderType === "export" ? [`IEC: ${order.iec || "-"}`, `LUT/Bond: ${order.lutBondReference || "-"}`, `Incoterm: ${order.incoterm || "-"}`, `Origin / destination: ${order.countryOfOrigin || "India"} / ${order.countryOfDestination || "-"}`, `Ports: ${order.portOfLoading || "-"} / ${order.portOfDischarge || "-"}`, "Supply intended for export under LUT/Bond without payment of integrated tax, where applicable."] : [];
  return buildPdf({ ...shared, title: order.orderType === "export" ? "COMMERCIAL INVOICE" : "TAX INVOICE", subtitle: `Invoice reference ${order.billId || order.orderNumber} | ${dateOnly(order.updatedAt)}`, sections: [{ heading: "Bill to / ship to", lines: [order.billingAddress || order.customerName, order.shippingAddress || order.billingAddress || "Address not recorded"] }, ...(exportLines.length ? [{ heading: "Export declaration", lines: exportLines }] : []), { heading: "Invoice items", columns: itemColumns, rows: rows(order) }, { heading: "Totals", lines: [`Subtotal: ${money(subtotal, order.currencyCode)}`, `GST: ${money(gst, order.currencyCode)}`, `Invoice total: ${money(total, order.currencyCode)}`, `Exchange rate to INR: ${Number(order.exchangeRate).toFixed(6)}`, `Payment terms: ${order.paymentTerms || "-"}`] }, { heading: "Dispatch references", lines: [`Transporter: ${dispatch?.transporterName || "-"}`, `LR/AWB: ${dispatch?.lrAwbNumber || "-"}`, `E-way bill: ${dispatch?.ewayBillNumber || "-"}`, `Shipping bill: ${dispatch?.shippingBillNumber || "-"}`] }] });
}
