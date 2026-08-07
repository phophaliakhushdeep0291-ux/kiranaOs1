import { describeOrderUrlReach, resolveCustomerOrderBase, type OrderUrlReach } from "@/features/core/customer-order/order-url";
import type { RestaurantTable } from "@/types/api";

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
  shopId,
  tableCode,
  configuredBaseUrl,
  currentOrigin,
  basePath = "",
}: {
  shopId: string;
  tableCode: string;
  configuredBaseUrl?: string | null;
  currentOrigin: string;
  basePath?: string;
}): string {
  if (!shopId || !tableCode) return "";
  // Built from the same resolver as the shop-wide order link, so a shop that has
  // configured a public address gets it here too rather than only on the
  // counter's QR — and so there is one answer to "where do we publish from?".
  const base = resolveCustomerOrderBase({ configuredBaseUrl, currentOrigin, basePath });
  if (!base) return "";
  return `${base}${tableOrderPath(shopId, tableCode)}`;
}

export function describeTableQr(args: {
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
 * Tables in the order they should be printed: by section, then by the shop's own
 * ordering. A printed sheet that runs T1, T10, T2 is a sheet somebody has to
 * sort by hand while the glue dries.
 */
export function tablesForPrinting(tables: RestaurantTable[]): RestaurantTable[] {
  return [...tables]
    .filter((table) => table.active)
    .sort((a, b) =>
      a.section.localeCompare(b.section)
      || a.sortOrder - b.sortOrder
      || a.name.localeCompare(b.name, undefined, { numeric: true }));
}
