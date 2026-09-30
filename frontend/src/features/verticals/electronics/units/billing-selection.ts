import type { BillInputItem } from "@/types/api";
export interface SelectedUnit { id: string; productId: string; label: string }
export function selectedUnits(value: unknown): SelectedUnit[] {
  return Array.isArray(value) ? value.filter((entry): entry is SelectedUnit => Boolean(entry && typeof entry.id === "string" && typeof entry.productId === "string" && typeof entry.label === "string")) : [];
}
/** One physical unit per bill line makes later returns unambiguous. Keep every paise of the line discount. */
export function prepareUnitBillItems(items: BillInputItem[], value: unknown): BillInputItem[] {
  const available = [...selectedUnits(value)];
  return items.flatMap((item) => {
    const units = available.filter((unit) => unit.productId === item.productId).slice(0, item.quantity);
    if (!Number.isInteger(item.quantity) || units.length !== item.quantity) return [item]; // Server refuses missing selections.
    const discountPaise = Math.round((item.lineDiscount ?? 0) * 100);
    const each = Math.floor(discountPaise / units.length);
    return units.map((unit, index) => {
      available.splice(available.indexOf(unit), 1);
      return { ...item, quantity: 1, trackedUnitId: unit.id, lineDiscount: (each + (index < discountPaise % units.length ? 1 : 0)) / 100 };
    });
  });
}
