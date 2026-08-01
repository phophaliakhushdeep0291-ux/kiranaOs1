import type { Product } from "@/types/api";

function normalize(value: unknown) {
  return String(value ?? "").trim().toLowerCase();
}

/** Resolve a scanner payload to one unambiguous product. */
export function resolvePurchaseBarcode(products: Product[], rawCode: string): Product | null {
  const code = normalize(rawCode);
  if (!code) return null;
  const matches = products.filter((product) => {
    if ([product.barcode, product.sku].some((value) => normalize(value) === code)) return true;
    return (product.sellingUnits ?? []).some((unit) => normalize(unit.barcode) === code);
  });
  return matches.length === 1 ? matches[0] : null;
}
