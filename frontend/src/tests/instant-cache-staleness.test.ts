import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it } from "vitest";
import { KEEP_EVERY_ROW, pruneRecentRows, RECENT_CACHE_DAYS } from "@/lib/offline/instant-cache";

const DAY = 24 * 60 * 60 * 1000;

/**
 * The billing page showed a handful of products, "View all products" did
 * nothing, and only a manual page reload fixed it. Two independent causes, both
 * in how the instant cache is handed to react-query.
 */
describe("instant cache must not pose as the server's answer", () => {
  /**
   * CAUSE 1. `initialData` with no `initialDataUpdatedAt` is dated NOW by
   * react-query, so under any staleTime the query never runs. The screen is
   * pinned to whatever the in-memory cache held, and because that cache is a
   * module-level Map, the only thing that clears it is reloading the page —
   * which is exactly the workaround the shopkeeper found.
   */
  async function mountWith(initialDataUpdatedAt: number | undefined) {
    let fetched = 0;
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const observer = new QueryObserver(client, {
      queryKey: ["products"],
      staleTime: 2 * 60_000,                    // BillingPage's staleTime
      initialData: [{ id: "cached-1" }],        // the short cached subset
      initialDataUpdatedAt,
      queryFn: async () => { fetched += 1; return [{ id: "p1" }, { id: "p2" }, { id: "p3" }]; },
    });
    const unsubscribe = observer.subscribe(() => {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    const rows = (observer.getCurrentResult().data ?? []).length;
    unsubscribe();
    client.clear();
    return { fetched, rows };
  }

  it("undated cache freezes the screen — the bug", async () => {
    expect(await mountWith(undefined)).toEqual({ fetched: 0, rows: 1 });
  });

  it("dated cache paints instantly and still fetches the rest", async () => {
    // 0 = "older than any staleTime", which is what an undatable cached value is.
    const { fetched, rows } = await mountWith(0);
    expect(fetched).toBe(1);
    expect(rows).toBe(3);
  });

  /**
   * CAUSE 2. The cache write pruned rows to a 30-day activity window. That is
   * right for a feed of bills and wrong for a catalogue: a product nobody has
   * edited in a month is still on the shelf, and dropping it deleted it from the
   * screen that sells it.
   */
  it("keeps master data that has not been touched in months", () => {
    const catalogue = [
      { id: "fresh", updatedAt: new Date(Date.now() - 2 * DAY).toISOString() },
      { id: "untouched-for-a-year", updatedAt: new Date(Date.now() - 365 * DAY).toISOString() },
    ];
    expect(pruneRecentRows(catalogue, RECENT_CACHE_DAYS).map((row) => row.id)).toEqual(["fresh"]);
    expect(pruneRecentRows(catalogue, KEEP_EVERY_ROW).map((row) => row.id))
      .toEqual(["fresh", "untouched-for-a-year"]);
  });
});
