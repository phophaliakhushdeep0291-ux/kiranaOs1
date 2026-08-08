export interface BillItemAddonDisplay {
  optionId?: string;
  groupName: string;
  name: string;
  price: number;
  quantity: number;
}

type AnyRow = Record<string, unknown>;

function asRow(value: unknown): AnyRow {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as AnyRow
    : {};
}

function finiteNumber(value: unknown, fallback: number): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

/**
 * Read the immutable add-on snapshots stored on a bill item.
 *
 * The aliases keep historical/offline payload shapes readable, while the
 * normalized result lets bill details, receipts, and future exports present
 * the same option names and quantities without re-reading the live menu.
 */
export function billItemAddons(item: unknown): BillItemAddonDisplay[] {
  const row = asRow(item);
  const source = Array.isArray(row.addons)
    ? row.addons
    : Array.isArray(row.billItemAddons)
      ? row.billItemAddons
      : Array.isArray(row.bill_item_addons)
        ? row.bill_item_addons
        : [];

  return source.flatMap((value) => {
    const addon = asRow(value);
    const name = String(addon.name ?? "").trim();
    if (!name) return [];
    return [{
      optionId: typeof addon.optionId === "string"
        ? addon.optionId
        : typeof addon.option_id === "string"
          ? addon.option_id
          : undefined,
      groupName: String(addon.groupName ?? addon.group_name ?? "").trim(),
      name,
      price: finiteNumber(addon.price ?? addon.priceDelta ?? addon.price_delta, 0),
      quantity: Math.max(1, finiteNumber(addon.quantity, 1)),
    }];
  });
}

export function billItemAddonSummary(item: unknown): string {
  return billItemAddons(item)
    .map((addon) => `${addon.quantity > 1 ? `${addon.quantity}× ` : ""}${addon.name}`)
    .join(", ");
}
