import { encodeQrSvg } from "@/lib/qr/qr-encoder";
import { ean13Svg, normalizeEan13 } from "@/lib/barcode/ean13";

/** Structural product shape — works with both api-client and types/api Products. */
export interface LabelProduct {
  id?: string;
  name?: string | null;
  sku?: string | null;
  barcode?: string | null;
  mrp?: number | null;
  defaultPricePerRateUnit?: number | null;
  sellingPrice?: number | null;
  displayUnit?: string | null;
  rateUnit?: string | null;
  unit?: string | null;
}

/**
 * Price-label printing: a printable sheet of shelf/product labels with the
 * shop-facing price, unit, and a scannable code — EAN-13 when the product has
 * a usable numeric barcode, otherwise a QR of the SKU/id so a 2D scanner can
 * still identify the product.
 */

export interface LabelPrintOptions {
  /** How many copies of each label (1–100, default 1). */
  copies?: number;
  /** Shop name printed at the top of each label. */
  shopName?: string | null;
}

interface LabelModel {
  name: string;
  priceLine: string;
  mrpLine: string | null;
  codeSvg: string;
  codeCaption: string | null;
}

function money(value: unknown): number {
  const amount = Number(value ?? 0);
  return Number.isFinite(amount) ? Math.round(amount * 100) / 100 : 0;
}

function inr(value: number): string {
  return `Rs ${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" }[char] ?? char));
}

function labelModel(product: LabelProduct): LabelModel {
  const price = money(product.defaultPricePerRateUnit ?? product.sellingPrice);
  const mrp = money(product.mrp);
  const unit = String(product.displayUnit ?? product.rateUnit ?? product.unit ?? "piece");
  const ean = normalizeEan13(typeof product.barcode === "string" ? product.barcode : null);
  const fallbackCode = String(product.sku ?? product.id ?? "").trim();
  return {
    name: String(product.name ?? "Product"),
    priceLine: `${inr(price)} / ${unit}`,
    mrpLine: mrp > price ? `MRP ${inr(mrp)}` : null,
    codeSvg: ean
      ? ean13Svg(ean, { moduleWidth: 2, height: 44 })
      : encodeQrSvg(fallbackCode || "product", { border: 2 }),
    codeCaption: ean ? null : fallbackCode || null,
  };
}

/** Full printable HTML document: a grid of 38×25mm-ish labels, print-ready. */
export function buildLabelSheetHtml(products: LabelProduct[], options: LabelPrintOptions = {}): string {
  const copies = Math.max(1, Math.min(100, Math.floor(options.copies ?? 1)));
  const shopName = String(options.shopName ?? "").trim();
  const labels = products.flatMap((product) => {
    const model = labelModel(product);
    return Array.from({ length: copies }, () => model);
  });
  const cells = labels.map((label) => `
      <div class="label">
        ${shopName ? `<div class="shop">${escapeHtml(shopName)}</div>` : ""}
        <div class="name">${escapeHtml(label.name)}</div>
        <div class="price">${escapeHtml(label.priceLine)}</div>
        ${label.mrpLine ? `<div class="mrp">${escapeHtml(label.mrpLine)}</div>` : ""}
        <div class="code">${label.codeSvg}</div>
        ${label.codeCaption ? `<div class="caption">${escapeHtml(label.codeCaption)}</div>` : ""}
      </div>`).join("");
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>Price labels</title>
<style>
  @page { margin: 6mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: -apple-system, "Segoe UI", Roboto, sans-serif; color: #000; }
  .sheet { display: flex; flex-wrap: wrap; gap: 3mm; padding: 3mm; }
  .label {
    width: 48mm; min-height: 30mm; padding: 2mm;
    border: 1px dashed #bbb; border-radius: 1.5mm;
    display: flex; flex-direction: column; align-items: center; justify-content: center;
    text-align: center; page-break-inside: avoid; overflow: hidden;
  }
  .shop { font-size: 7pt; color: #444; max-width: 100%; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .name { font-size: 8.5pt; font-weight: 700; line-height: 1.15; max-height: 2.4em; overflow: hidden; }
  .price { font-size: 11pt; font-weight: 800; margin-top: 0.5mm; }
  .mrp { font-size: 7pt; color: #444; }
  .code { margin-top: 1mm; max-width: 100%; }
  .code svg { max-width: 44mm; max-height: 16mm; height: auto; display: block; }
  .caption { font-size: 6.5pt; font-family: monospace; color: #333; max-width: 100%; overflow: hidden; text-overflow: ellipsis; }
  @media print { .label { border-color: #ddd; } }
</style>
</head>
<body>
  <div class="sheet">${cells}</div>
  <script>window.addEventListener("load", () => { window.focus(); window.print(); });</script>
</body>
</html>`;
}

/** Open the label sheet in a print window. Returns false when pop-ups are blocked. */
export function openLabelPrintWindow(products: LabelProduct[], options: LabelPrintOptions = {}): boolean {
  const printWindow = window.open("", "_blank", "width=900,height=700");
  if (!printWindow) return false;
  printWindow.document.open();
  printWindow.document.write(buildLabelSheetHtml(products, options));
  printWindow.document.close();
  return true;
}
