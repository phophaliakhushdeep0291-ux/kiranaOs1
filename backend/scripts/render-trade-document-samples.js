import fs from "node:fs";
import path from "node:path";
import { buildPdf } from "../src/lib/documents/pdf.js";

const output = path.resolve("../output/pdf");
fs.mkdirSync(output, { recursive: true });
const items = [
  { sku: "SPC-500G", description: "Premium Spice Mix 500 g", hsn: "091099", batch: "B240801", qty: 24, rate: "125.00", amount: "3000.00" },
  { sku: "SPC-1KG", description: "Premium Spice Mix 1 kg", hsn: "091099", batch: "B240802", qty: 12, rate: "230.00", amount: "2760.00" },
];
const columns = [{ key: "sku", label: "SKU", width: 75 }, { key: "description", label: "Description", width: 155 }, { key: "hsn", label: "HSN", width: 60 }, { key: "batch", label: "Batch", width: 70 }, { key: "qty", label: "Qty", width: 45, align: "right" }, { key: "rate", label: "Rate", width: 55, align: "right" }, { key: "amount", label: "Amount", width: 65, align: "right" }];
const docs = {
  "trade-tax-invoice-sample.pdf": { title: "TAX INVOICE", subtitle: "Invoice INV-2026-001 | 2026-08-13", meta: [{ label: "Seller", value: "Example Foods Private Limited" }, { label: "Seller GSTIN", value: "27ABCDE1234F1Z5" }, { label: "Buyer", value: "Example Supermart" }, { label: "Buyer PO", value: "PO-8842" }], sections: [{ heading: "Invoice items", columns, rows: items }, { heading: "Totals", lines: ["Subtotal: INR 5760.00", "GST: INR 691.20", "Invoice total: INR 6451.20"] }] },
  "trade-packing-list-sample.pdf": { title: "PACKING LIST", subtitle: "Dispatch DSP-2026-001 | 2026-08-13", meta: [{ label: "Buyer", value: "Example Supermart" }, { label: "Ship to", value: "Warehouse 4, Industrial Area, Mumbai" }], sections: [{ heading: "Packed goods", columns, rows: items }, { heading: "Shipment", lines: ["Packages: 6", "Net weight: 24.0 kg", "Gross weight: 26.5 kg", "Container / seal: CONT-442 / SEAL-89"] }] },
  "trade-marketplace-label-sample.pdf": { title: "MARKETPLACE SHIPPING LABEL", subtitle: "Seller generated - use platform-issued label where required", meta: [{ label: "Shipment / order", value: "SHIP-784920" }, { label: "Seller", value: "Example Foods Private Limited" }, { label: "Deliver to", value: "Example Customer" }, { label: "Address", value: "42 Market Road, Pune, Maharashtra 411001" }, { label: "Packages", value: "1" }], sections: [{ heading: "Contents", columns: columns.slice(0, 2).concat([{ key: "qty", label: "Qty", width: 70, align: "right" }]), rows: items }, { heading: "Handling", lines: ["Scan/verify shipment ID before handover.", "Keep proof of dispatch and proof of delivery."] }] },
};
for (const [name, doc] of Object.entries(docs)) fs.writeFileSync(path.join(output, name), buildPdf({ ...doc, footer: "Sample generated for layout verification - not a legal invoice." }));
console.log(JSON.stringify(Object.keys(docs)));
