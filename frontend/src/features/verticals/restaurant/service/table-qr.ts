import { describeOrderUrlReach, resolveCustomerOrderBase, type OrderUrlReach } from "@/features/core/customer-order/order-url";
import { restaurantGuestUrl } from "@/features/core/customer-order/restaurant-website";

/**
 * Where the QR sticker on a table points.
 *
 * A per-table code exists for one reason: the guest should not have to tell
 * anyone where they are sitting. The waiter should not have to ask either, and
 * the kitchen ticket should say "T5" without a human having typed it. So the
 * table travels in the link, and the whole flow works without a single field
 * the guest could get wrong.
 *
 * The address itself is the shop's ordinary customer-order URL, so everything
 * already learned about publishing it holds — including that a QR printed from a
 * till running on localhost is a QR that can never open on a guest's phone. That
 * check lives in `order-url.ts` and is re-exported here rather than re-derived,
 * because two implementations of "can a phone reach this?" would eventually
 * disagree and the one that is wrong would be the one on the sticker.
 */

export interface TableQrTarget {
  url: string;
  reach: OrderUrlReach;
}

/**
 * A shorter path than `/order/<shop>?table=t5`, because this one gets printed.
 * Under a sticker, a QR encoding fewer characters is a QR with larger modules —
 * which is the difference between a scan that works at arm's length in dim
 * restaurant light and one a guest has to hunt for.
 */
export function tableOrderPath(shopId: string, tableCode: string): string {
  return `/t/${encodeURIComponent(shopId)}/${encodeURIComponent(tableCode)}`;
}

export function buildTableOrderUrl({
  websiteUrl,
  shopId,
  tableCode,
  configuredBaseUrl,
  currentOrigin,
  basePath = "",
}: {
  websiteUrl?: string | null;
  shopId: string;
  tableCode: string;
  configuredBaseUrl?: string | null;
  currentOrigin: string;
  basePath?: string;
}): string {
  if (!shopId || !tableCode) return "";
  const dedicated = restaurantGuestUrl(websiteUrl, tableCode);
  if (dedicated) return dedicated;
  // Built from the same resolver as the shop-wide order link, so a shop that has
  // configured a public address gets it here too rather than only on the
  // counter's QR — and so there is one answer to "where do we publish from?".
  const base = resolveCustomerOrderBase({ configuredBaseUrl, currentOrigin, basePath });
  if (!base) return "";
  return `${base}${tableOrderPath(shopId, tableCode)}`;
}

export function describeTableQr(args: {
  websiteUrl?: string | null;
  shopId: string;
  tableCode: string;
  configuredBaseUrl?: string | null;
  currentOrigin: string;
  basePath?: string;
}): TableQrTarget {
  const url = buildTableOrderUrl(args);
  return { url, reach: describeOrderUrlReach(url) };
}

/**
 * The code the server will derive from a table's name.
 *
 * A deliberate second copy of the server's `slugifyTableCode`, and the two must
 * agree: this is how the till matches the floor it holds against the floor the
 * server published, without inventing codes of its own. A client that guessed
 * differently would republish the whole floor on every load, quietly retiring
 * and recreating tables whose stickers are already on the wall.
 *
 * `src/tests/restaurant-table-qr.test.ts` pins the pairs that matter.
 */
export function tableCodeForName(name: string): string {
  const slug = String(name ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32);
  return slug || "table";
}

/**
 * Fold the codes the server published back onto the floor this device holds.
 *
 * The till keeps its own table ids on purpose: they key the table -> open-order
 * map, and rewriting them would drop every seating currently on the floor. What
 * comes back from the server is the one thing the till cannot know — what the
 * sticker on each table says.
 */
export function mergeServerCodes<T extends { name: string }>(
  plan: T[],
  published: Array<{ code: string; name: string; selfOrderEnabled: boolean }>,
): Array<T & { code?: string; selfOrderEnabled?: boolean }> {
  const byCode = new Map(published.map((table) => [table.code, table]));
  return plan.map((table) => {
    const match = byCode.get(tableCodeForName(table.name));
    if (!match) return table;
    return { ...table, code: match.code, selfOrderEnabled: match.selfOrderEnabled };
  });
}

/** Tables this device holds that the server has never seen — nothing to print for them yet. */
export function unpublishedTables<T extends { name: string; code?: string }>(plan: T[]): T[] {
  return plan.filter((table) => !table.code);
}

/**
 * Tables in the order they should be printed: by section, then by the shop's own
 * ordering. A printed sheet that runs T1, T10, T2 is a sheet somebody has to
 * sort by hand while the glue dries.
 */
export function tablesForPrinting<T extends PrintableTable>(tables: T[]): T[] {
  return [...tables]
    // A table with no code has no sticker to print: the server has never seen
    // it, so a QR made here would resolve to nothing on the guest's phone.
    .filter((table) => Boolean(table.code) && table.active !== false)
    .sort((a, b) =>
      (a.section ?? "").localeCompare(b.section ?? "")
      || (a.sortOrder ?? 0) - (b.sortOrder ?? 0)
      || a.name.localeCompare(b.name, undefined, { numeric: true }));
}

/**
 * Structural rather than the API type, because both floors print the same:
 * the one the server holds, and the one the till is showing on screen.
 */
export interface PrintableTable {
  id: string;
  name: string;
  code?: string;
  section?: string;
  sortOrder?: number;
  active?: boolean;
}
