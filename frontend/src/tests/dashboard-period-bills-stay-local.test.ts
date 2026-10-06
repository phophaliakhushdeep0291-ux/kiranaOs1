import { readFileSync } from "node:fs";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

/**
 * Home fetched two lists of up to 1,000 bills — this period and the one before —
 * and the refresh after every sale on any counter fetched both again: about
 * 1.2 MB of JSON a sale for a shop doing a hundred bills a day, on every counter
 * with Home open. What the period cards and chart show is the local report; when
 * it cannot be read the page shows LocalDataUnavailable. The lists only painted
 * the moment before the report landed, which their cached seed does on its own.
 */

const page = readFileSync("src/features/core/dashboard/pages/DashboardPage.tsx", "utf8");

describe("the dashboard's period bills", () => {
  it("are never fetched", () => {
    expect(page).toContain("useListBills({ ...periodRange, limit: 1000 }, { query: { enabled: false } })");
    expect(page).toContain("useListBills({ ...previousPeriodRange, limit: 1000 }, { query: { enabled: false } })");
  });

  it("only stand in until the local report is read, which is what the cards show", () => {
    // If either of these stops holding, the lists may be what the owner sees, and
    // they must be fetched again.
    expect(page).toMatch(/const periodSales = activePeriodReport\s*\?\s*activePeriodReport\.selected\.sales/);
    expect(page).toMatch(/if \(activePeriodReport\) \{\s*if \(period === "today"\)/);
    expect(page).toContain("if (periodReadError) return <LocalDataUnavailable");
  });
});

describe("a disabled query seeded from the cache", () => {
  it("keeps its seed and is not fetched by any refresh the app makes", async () => {
    const client = new QueryClient();
    const queryFn = vi.fn(async () => ({ bills: [{ id: "from-server" }], total: 1 }));
    const seed = { bills: [{ id: "from-cache" }], total: 1 };
    const observer = new QueryObserver(client, {
      queryKey: ["bills", { from: "2026-09-30", to: "2026-10-06", limit: 1000 }],
      queryFn,
      enabled: false,
      initialData: seed,
      initialDataUpdatedAt: 0,
    });
    const unsubscribe = observer.subscribe(() => undefined);

    // The refresh bridge after a local write or sync, a full refresh on reconnect
    // or focus, and the cloud bootstrap's refetch of everything on screen.
    await client.invalidateQueries({ refetchType: "active" });
    await client.invalidateQueries();
    await client.refetchQueries({ type: "active" });
    client.getQueryCache().onFocus();
    client.getQueryCache().onOnline();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(queryFn).not.toHaveBeenCalled();
    expect(observer.getCurrentResult().data).toEqual(seed);
    unsubscribe();
    client.clear();
  });
});
