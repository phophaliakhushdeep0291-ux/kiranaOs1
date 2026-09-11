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
  lots: Array<{ id: string; productId: string; batchNumber: string; expiresOn: string; availableBaseQty: number; sellingUnitId?: string | null }>;
};
export type QuantityDraft = { amount: string; sellingUnitId: string; inventoryLotId?: string };
export type QuantityRow = QuantityDraft & { key: string };
export type CompletionDraft = {
  outputs: QuantityRow[]; materials: Record<string, QuantityRow[]>; batch: string;
  manufacturedOn: string; expiresOn: string; qcStatus: "passed" | "conditional" | "failed"; notes: string;
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
export function newQuantityRow(product: Product | undefined, base?: number): QuantityRow {
  const unit = product?.packagingMode === "per_pack" ? product.sellingUnits?.find((entry) => entry.id && entry.isActive && entry.conversionToBase > 0) : undefined;
  return { key: crypto.randomUUID(), amount: base == null ? "" : String(rounded(base / (unit?.conversionToBase || 1))), sellingUnitId: unit?.id || "", inventoryLotId: "" };
}
export function totalQuantity(product: Product | undefined, rows: QuantityDraft[]) {
  return rounded(rows.reduce((sum, row) => sum + (baseQuantity(product, row) || 0), 0));
}
export function initialCompletion(details: RunDetails): CompletionDraft {
  const quantity = (productId: string, base: number) => newQuantityRow(details.products.find((entry) => entry.id === productId), base);
  const now = new Date();
  const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  return {
    outputs: [quantity(details.run.bom.finishedProductId, details.run.plannedOutputBaseQty)],
    materials: Object.fromEntries(details.run.bom.items.map((item) => [item.materialProductId, [quantity(item.materialProductId, plannedMaterial(details.run, item))]])),
    batch: "", manufacturedOn: today, expiresOn: "", qcStatus: "conditional", notes: "",
  };
}

/** Reject incomplete entries before requesting a stock transaction. */
export function completionPayload(details: RunDetails, draft: CompletionDraft) {
  const row = (productId: string, value: QuantityDraft) => {
    const product = details.products.find((entry) => entry.id === productId);
    const qty = baseQuantity(product, value);
    const amount = Number(value.amount);
    if (!product || !Number.isFinite(qty) || qty <= 0 || qty > 1e9
      || !Number.isFinite(amount) || amount < 0.01 || amount > 1e9 || Math.abs(amount - rounded(amount)) > 1e-7
      || (product.packagingMode === "per_pack" && !value.sellingUnitId)) throw new Error("quantity");
    return { qty, ...(value.sellingUnitId ? { sellingUnitId: value.sellingUnitId, packageCount: Number(value.amount) } : {}) };
  };
  if (!draft.batch.trim() || draft.batch.trim().length > 80) throw new Error("batch");
  const validDay = (day: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
    const date = new Date(`${day}T00:00:00Z`);
    return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === day;
  };
  // A scrapped batch is never stored, so it carries no expiry — only a reason.
  const scrapped = draft.qcStatus === "failed";
  if (!validDay(draft.manufacturedOn) || (!scrapped && (!validDay(draft.expiresOn) || draft.expiresOn <= draft.manufacturedOn))) throw new Error("dates");
  if (scrapped && !draft.notes.trim()) throw new Error("reason");
  if (!draft.outputs.length || draft.outputs.length > 50) throw new Error("quantity");
  const outputUnits = new Set<string>();
  const outputs = draft.outputs.map((value) => {
    if (outputUnits.has(value.sellingUnitId)) throw new Error("duplicateOutput");
    outputUnits.add(value.sellingUnitId);
    const { qty, ...pack } = row(details.run.bom.finishedProductId, value);
    return { quantityBaseQty: qty, ...pack };
  });
  const outputTotal = rounded(outputs.reduce((sum, output) => sum + output.quantityBaseQty, 0));
  if (outputTotal > 1e9) throw new Error("quantity");
  const usedLots = new Map<string, number>();
  const consumptions = details.run.bom.items.flatMap((item) => {
    const values = draft.materials[item.materialProductId];
    if (!values?.length || values.length > 50) throw new Error("quantity");
    const seen = new Set<string>();
    let materialTotal = 0;
    return values.map((value) => {
      const key = JSON.stringify([value.inventoryLotId || null, value.sellingUnitId || null]);
      if (seen.has(key)) throw new Error("duplicateSource");
      seen.add(key);
      const material = row(item.materialProductId, value);
      materialTotal = rounded(materialTotal + material.qty);
      if (materialTotal > 1e9) throw new Error("quantity");
      const product = details.products.find((entry) => entry.id === item.materialProductId)!;
      const lot = value.inventoryLotId ? details.lots.find((entry) => entry.id === value.inventoryLotId && entry.productId === product.id) : undefined;
      if ((product.batchTrackingEnabled && !lot) || (value.inventoryLotId && !lot)) throw new Error("sourceBatch");
      if (lot?.sellingUnitId && lot.sellingUnitId !== value.sellingUnitId) throw new Error("sourcePack");
      if (lot) {
        const total = rounded((usedLots.get(lot.id) || 0) + material.qty);
        if (total > lot.availableBaseQty) throw new Error("stock");
        usedLots.set(lot.id, total);
      }
      const { qty, ...pack } = material;
      return { productId: product.id, actualBaseQty: qty, inventoryLotId: lot?.id ?? null, ...pack };
    });
  });
  if (consumptions.length > 1000) throw new Error("quantity");
  return {
    actualOutputBaseQty: outputTotal, finishedBatchNumber: draft.batch.trim(), manufacturedOn: draft.manufacturedOn,
    expiresOn: scrapped ? null : draft.expiresOn, qcStatus: draft.qcStatus, notes: draft.notes.trim() || null,
    consumptions, outputs: scrapped ? [] : outputs,
  };
}
