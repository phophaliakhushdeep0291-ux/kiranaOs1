import type { Product } from "@/types/api";

export type MaterialDraft = { key: string; productId: string; quantity: string; wastage: string };
export type RecipeDraft = { name: string; finishedProductId: string; output: string; materials: MaterialDraft[] };
export function recipePayload(draft: RecipeDraft, products: Product[]) {
  const available = new Map(products.map((product) => [product.id, product]));
  const finished = available.get(draft.finishedProductId);
  if (!finished?.batchTrackingEnabled) throw new Error("finished");
  if (draft.name.trim().length < 2 || draft.name.trim().length > 160) throw new Error("name");
  const quantity = (value: string) => {
    const number = Number(value);
    if (!Number.isFinite(number) || number < 0.01 || number > 1e9 || Math.abs(number - Math.round(number * 100) / 100) > 1e-7) throw new Error("quantity");
    return number;
  };
  const seen = new Set<string>();
  if (!draft.materials.length || draft.materials.length > 100) throw new Error("materials");
  const items = draft.materials.map((row) => {
    if (!available.has(row.productId) || row.productId === finished.id || seen.has(row.productId)) throw new Error("materials");
    seen.add(row.productId);
    const wastagePercent = Number(row.wastage);
    if (!row.wastage.trim() || !Number.isFinite(wastagePercent) || wastagePercent < 0 || wastagePercent > 100) throw new Error("wastage");
    return { materialProductId: row.productId, quantityBaseQty: quantity(row.quantity), wastagePercent };
  });
  return { name: draft.name.trim(), finishedProductId: finished.id, outputQuantityBaseQty: quantity(draft.output), items };
}
