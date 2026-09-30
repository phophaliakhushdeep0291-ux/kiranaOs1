import { z } from "zod";
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

const text = z.string().max(40_000);
const receiveDraftSchema = z.object({
  open: z.boolean(), productId: text, productSearch: text, costPrice: text, warrantyMonths: text,
  purchaseBillId: text, bulk: text,
  units: z.array(z.object({ imei: text, imei2: text, serialNumber: text, condition: z.enum(["new", "open_box", "refurbished"]) })).max(200),
});

export const receiveUnitsDraft = createCounterDraft(() => ({
  open: false, productId: "", productSearch: "", costPrice: "0", warrantyMonths: "12",
  purchaseBillId: "", units: [emptyUnit()], bulk: "",
}), { key: "receive-units", parse: (value) => receiveDraftSchema.parse(value) });

/**
 * Catching the register up with a sale that was billed without its serial.
 *
 * Survives the counter locking, like the form above, but is deliberately NOT
 * written to disk: it holds a buyer's name and phone number, and a shared shop
 * device is not somewhere to leave those for a week.
 */
export const unitSaleDraft = createCounterDraft(() => ({
  unit: null as ProductUnit | null, billNumber: "", soldOn: "", customerName: "", customerPhone: "", sellingPrice: "0",
}));
