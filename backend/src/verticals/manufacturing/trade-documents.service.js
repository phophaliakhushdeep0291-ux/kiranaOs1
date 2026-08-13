import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { buildPdf } from "../../lib/documents/pdf.js";
import { getTradeOrder } from "./trade-orders.service.js";

const money = (value, currency = "INR") => `${currency} ${Number(value || 0).toFixed(2)}`;
const dateOnly = (value) => value ? new Date(value).toISOString().slice(0, 10) : "-";

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
  const exportLines = order.orderType === "export" ? [`IEC: ${order.iec || "-"}`, `LUT/Bond: ${order.lutBondReference || "-"}`, `Incoterm: ${order.incoterm || "-"}`, `Origin / destination: ${order.countryOfOrigin || "India"} / ${order.countryOfDestination || "-"}`, `Ports: ${order.portOfLoading || "-"} / ${order.portOfDischarge || "-"}`, "Supply intended for export under LUT/Bond without payment of integrated tax, where applicable."] : [];
  return buildPdf({ ...shared, title: order.orderType === "export" ? "COMMERCIAL INVOICE" : "TAX INVOICE", subtitle: `Invoice reference ${order.billId || order.orderNumber} | ${dateOnly(order.updatedAt)}`, sections: [{ heading: "Bill to / ship to", lines: [order.billingAddress || order.customerName, order.shippingAddress || order.billingAddress || "Address not recorded"] }, ...(exportLines.length ? [{ heading: "Export declaration", lines: exportLines }] : []), { heading: "Invoice items", columns: itemColumns, rows: rows(order) }, { heading: "Totals", lines: [`Subtotal: ${money(subtotal, order.currencyCode)}`, `GST: ${money(gst, order.currencyCode)}`, `Invoice total: ${money(total, order.currencyCode)}`, `Exchange rate to INR: ${Number(order.exchangeRate).toFixed(6)}`, `Payment terms: ${order.paymentTerms || "-"}`] }, { heading: "Dispatch references", lines: [`Transporter: ${dispatch?.transporterName || "-"}`, `LR/AWB: ${dispatch?.lrAwbNumber || "-"}`, `E-way bill: ${dispatch?.ewayBillNumber || "-"}`, `Shipping bill: ${dispatch?.shippingBillNumber || "-"}`] }] });
}
