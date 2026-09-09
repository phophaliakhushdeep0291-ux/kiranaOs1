import type { Product } from "@/types/api";

export type ProductionBom = {
  id: string; name: string; status: string; finishedProductId: string; outputQuantityBaseQty: number;
  items: Array<{ materialProductId: string; quantityBaseQty: number; wastagePercent: number }>;
};
export type ProductionRun = {
  id: string; bomId: string; locationId: string; runNumber: string; status: string; qcStatus: string;
  plannedOutputBaseQty: number; actualOutputBaseQty?: number | null; finishedBatchNumber?: string | null;
  bom: { name: string };
};
export type RunDetails = {
  run: ProductionRun & { bom: ProductionBom };
  products: Product[];
  lots: Array<{ id: string; productId: string; batchNumber: string; expiresOn: string; availableBaseQty: number }>;
};
export type QuantityDraft = { amount: string; sellingUnitId: string; inventoryLotId?: string };
export type CompletionDraft = {
  actual: QuantityDraft; materials: Record<string, QuantityDraft>; batch: string;
  manufacturedOn: string; expiresOn: string; qcStatus: "passed" | "conditional"; notes: string;
};

const rounded = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
export function baseQuantity(product: Product | undefined, draft: QuantityDraft) {
  const multiplier = draft.sellingUnitId
    ? product?.sellingUnits?.find((unit) => unit.id === draft.sellingUnitId && unit.isActive)?.conversionToBase
    : 1;
  return rounded(Number(draft.amount) * Number(multiplier));
}
export function plannedMaterial(run: RunDetails["run"], item: ProductionBom["items"][number]) {
  return rounded(item.quantityBaseQty * run.plannedOutputBaseQty / run.bom.outputQuantityBaseQty * (1 + (item.wastagePercent || 0) / 100));
}
export function initialCompletion(details: RunDetails): CompletionDraft {
  const quantity = (productId: string, base: number): QuantityDraft => {
    const product = details.products.find((entry) => entry.id === productId);
    const unit = product?.packagingMode === "per_pack" ? product.sellingUnits?.find((entry) => entry.id && entry.isActive && entry.conversionToBase > 0) : undefined;
    return { amount: String(rounded(base / (unit?.conversionToBase || 1))), sellingUnitId: unit?.id || "", inventoryLotId: "" };
  };
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    actual: quantity(details.run.bom.finishedProductId, details.run.plannedOutputBaseQty),
    materials: Object.fromEntries(details.run.bom.items.map((item) => [item.materialProductId, quantity(item.materialProductId, plannedMaterial(details.run, item))])),
    batch: "", manufacturedOn: today, expiresOn: "", qcStatus: "conditional", notes: "",
  };
}

/** Reject incomplete entries before requesting a stock transaction. */
export function completionPayload(details: RunDetails, draft: CompletionDraft) {
  const row = (productId: string, value: QuantityDraft) => {
    const product = details.products.find((entry) => entry.id === productId);
    const qty = baseQuantity(product, value);
    if (!product || !Number.isFinite(qty) || qty <= 0 || qty > 1e9
      || (product.packagingMode === "per_pack" && !value.sellingUnitId)) throw new Error("quantity");
    return { qty, ...(value.sellingUnitId ? { sellingUnitId: value.sellingUnitId, packageCount: Number(value.amount) } : {}) };
  };
  if (!draft.batch.trim() || draft.batch.trim().length > 80) throw new Error("batch");
  const validDay = (day: string) => /^\d{4}-\d{2}-\d{2}$/.test(day) && new Date(`${day}T00:00:00Z`).toISOString().slice(0, 10) === day;
  if (!validDay(draft.manufacturedOn) || !validDay(draft.expiresOn) || draft.expiresOn <= draft.manufacturedOn) throw new Error("dates");
  const output = row(details.run.bom.finishedProductId, draft.actual);
  const consumptions = details.run.bom.items.map((item) => {
    const value = draft.materials[item.materialProductId];
    if (!value) throw new Error("quantity");
    const material = row(item.materialProductId, value);
    const product = details.products.find((entry) => entry.id === item.materialProductId)!;
    const lot = value.inventoryLotId ? details.lots.find((entry) => entry.id === value.inventoryLotId && entry.productId === product.id) : undefined;
    if ((product.batchTrackingEnabled && !lot) || (value.inventoryLotId && !lot)) throw new Error("sourceBatch");
    if (lot && material.qty > lot.availableBaseQty) throw new Error("stock");
    const { qty, ...pack } = material;
    return { productId: product.id, actualBaseQty: qty, inventoryLotId: lot?.id ?? null, ...pack };
  });
  const { qty, ...outputPack } = output;
  return {
    actualOutputBaseQty: qty, finishedBatchNumber: draft.batch.trim(), manufacturedOn: draft.manufacturedOn,
    expiresOn: draft.expiresOn, qcStatus: draft.qcStatus, notes: draft.notes.trim() || null,
    consumptions, outputs: [{ quantityBaseQty: qty, ...outputPack }],
  };
}
