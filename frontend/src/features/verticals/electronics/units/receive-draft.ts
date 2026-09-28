import { createCounterDraft } from "@/lib/counter-draft";
import type { ProductUnit, ProductUnitCondition } from "@/types/api";

export interface DraftUnit {
  imei: string;
  imei2: string;
  serialNumber: string;
  condition: ProductUnitCondition;
}

export function emptyUnit(overrides: Partial<DraftUnit> = {}): DraftUnit {
  return { imei: "", imei2: "", serialNumber: "", condition: "new", ...overrides };
}

export const receiveUnitsDraft = createCounterDraft(() => ({
  open: false, productId: "", productSearch: "", costPrice: "0", warrantyMonths: "12",
  purchaseBillId: "", units: [emptyUnit()], bulk: "",
}));

export const unitSaleDraft = createCounterDraft(() => ({
  unit: null as ProductUnit | null, billNumber: "", customerName: "", customerPhone: "", sellingPrice: "0",
}));
