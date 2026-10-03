import { readFileSync } from "node:fs";
import "fake-indexeddb/auto";
import Dexie from "dexie";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const session = vi.hoisted(() => ({ tenant_id: "shop-a", store_id: "store-a", device_id: "counter-a" }));
vi.mock("@/lib/offline/context", async (original) => ({ ...await original<typeof import("@/lib/offline/context")>(), getOfflineScope: () => ({ ...session }) }));
vi.mock("@/lib/offline/instant-cache", () => ({ readInstantCache: (_key: string, fallback: unknown) => fallback, writeInstantCache: vi.fn() }));
import { dexieDB, offlineDB } from "@/lib/offline/db";
import { loadRecentDashboardBills, dashboardChangeAffects } from "@/features/core/dashboard/local-reads";
import { loadCustomerDetail } from "@/features/core/customers/customer-ledger-data";
import { dedupeBillsForDisplay } from "@/features/core/sync/bill-reconciliation";
import { refreshBusinessCaches } from "@/features/core/sync/sync-reconcile";
import { writeInstantCache } from "@/lib/offline/instant-cache";
const historicalSchemas = JSON.parse(readFileSync(new URL("./fixtures/offline-schema-v1-v7.json", import.meta.url), "utf8")) as Record<string, Record<string, string>>;

type Row = Record<string, unknown> & { id: string };
const row = (id: string, extra: Record<string, unknown> = {}): Row => ({ id, tenant_id: "shop-a", store_id: "store-a", created_at: "2026-10-01T08:00:00Z", updated_at: "2026-10-01T08:00:00Z", sync_status: "synced", version: 1, ...extra });
const sale = (id: string, at: string, extra: Record<string, unknown> = {}) => row(id, { createdAt: at, clientBillId: `client-${id}`, billNo: id, billType: "sale", status: "completed", grandTotal: 100, ...extra });
beforeEach(async () => { session.store_id = "store-a"; dexieDB.close(); await Dexie.delete(dexieDB.name); await dexieDB.open(); });
afterEach(async () => { vi.restoreAllMocks(); dexieDB.close(); await Dexie.delete(dexieDB.name); });

it("upgrades actual version-seven rows without changing original fields", async () => {
  dexieDB.close(); await Dexie.delete(dexieDB.name);
  const old = new Dexie(dexieDB.name);
  old.version(7).stores(historicalSchemas[7]); await old.open();
  const saved = row("legacy", { serverCustomerId: "  customer-1  ", createdAt: "2026-09-01T08:00:00Z", localBillId: "local-legacy" });
  const queued = { clientEventId: "queued-bill", status: "PENDING", payload: { id: "legacy" } };
  const license = { id: "device-license", device_fingerprint: "counter-a", status: "active" };
  await old.table("bills").put(saved);
  await old.table("sync_outbox").put(queued);
  await old.table("device_license_cache").put(license);
  old.close(); await dexieDB.open();
  expect(await dexieDB.table("sync_outbox").get("queued-bill")).toEqual(queued);
  expect(await dexieDB.table("device_license_cache").get("device-license")).toEqual(license);
  expect(await dexieDB.table("bills").get("legacy")).toMatchObject(saved);
  expect(await offlineDB.getWhere<Row>("bills", "_read_customer_id", ["customer-1"])).toHaveLength(1);
  expect(dexieDB.verno).toBe(8);
});

it("maintains keys on direct writes, partial updates, reference rewrites and reload", async () => {
  await dexieDB.table("bills").put(sale("b-1", "2026-10-01T10:00:00Z", { customerId: "old", serverCustomerId: "wrong" }));
  await dexieDB.table("bills").update("b-1", { customerId: undefined, localBillId: "alias", serverCustomerId: "new" });
  expect(await offlineDB.getWhere<Row>("bills", "_read_customer_id", ["old"])).toEqual([]);
  expect(await offlineDB.getWhere<Row>("bills", "_read_customer_id", ["new"])).toHaveLength(1);
  await dexieDB.table("bills").toCollection().modify((r) => { r.serverCustomerId = "newer"; });
  dexieDB.close(); await dexieDB.open();
  expect(await offlineDB.getWhere<Row>("bills", "_read_bill_ids", ["alias"])).toHaveLength(1);
  expect(await offlineDB.getWhere<Row>("bills", "_read_customer_id", ["newer"])).toHaveLength(1);
});

it("filters by shop before the newest-row limit and rejects an in-flight shop switch", async () => {
  await dexieDB.table("bills").bulkPut([sale("mine", "2026-10-01T08:00:00Z"), sale("foreign", "2026-10-02T08:00:00Z", { store_id: "store-b" })]);
  expect((await offlineDB.getLatest<Row>("bills", "_read_created_at", 1)).map((r) => r.id)).toEqual(["mine"]);
  const original = offlineDB.getLatest.bind(offlineDB);
  vi.spyOn(offlineDB, "getLatest").mockImplementation(async (...args) => { const rows = await original(...args); session.store_id = "store-b"; return rows; });
  await expect(loadRecentDashboardBills()).rejects.toThrow("different shop");
});

it("does not touch storage for an empty newest-row request", async () => {
  const open = vi.spyOn(dexieDB, "open");
  expect(await offlineDB.getLatest("bills", "_read_created_at", 0)).toEqual([]); expect(open).not.toHaveBeenCalled();
});

describe("dashboard", () => {
  it("loads ten recent sales and children without reading the whole history", async () => {
    // The serial measurement uses 10k; keep routine parallel CI fixtures smaller.
    const historySize = process.env.KIRANA_MEASURE_HISTORY ? 10_000 : 1_000;
    const history = Array.from({ length: historySize }, (_, i) => sale(`b-${i}`, new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString()));
    await dexieDB.table("bills").bulkPut(history);
    await dexieDB.table("bill_items").bulkPut(history.map((b) => row(`item-${b.id}`, { bill_id: b.id, name: "Rice", quantity: 1 })));
    await dexieDB.table("payments").bulkPut(history.map((b) => row(`payment-${b.id}`, { billId: b.id, amount: 100, mode: "upi" })));
    // Read the same fixture through the previous three whole-table reads.
    const baseline = await Promise.all([offlineDB.getAll<Row>("bills"), offlineDB.getAll<Row>("bill_items"), offlineDB.getAll<Row>("payments")]);
    expect(baseline.map((rows) => rows.length)).toEqual([historySize, historySize, historySize]);
    const scans = vi.spyOn(offlineDB, "getAll"), latest = vi.spyOn(offlineDB, "getLatest"), where = vi.spyOn(offlineDB, "getWhere");
    const result = await loadRecentDashboardBills();
    expect(result.map((b) => b.id)).toEqual(history.slice(-10).reverse().map((b) => b.id));
    expect(result[0].items).toHaveLength(1); expect(result[0].payments).toHaveLength(1); expect(scans).not.toHaveBeenCalled();
    expect(latest).toHaveBeenCalledWith("bills", "_read_created_at", 20);
    const returned = await Promise.all(where.mock.results.map((call) => call.value));
    const loaded = returned.reduce((sum, rows) => sum + rows.length, 0) + (await latest.mock.results[0].value).length;
    expect(loaded).toBe(80);
    if (process.env.KIRANA_MEASURE_HISTORY) process.stdout.write(JSON.stringify({ workload: "10000-bills-one-item-one-payment", displayedBills: result.length, beforeRows: 30000, afterRows: loaded }) + "\n");
  }, process.env.KIRANA_MEASURE_HISTORY ? 60_000 : 20_000);
  it("finds an older cancelled twin without resurrecting its active echo", async () => {
    await dexieDB.table("bills").bulkPut([
      ...Array.from({ length: 25 }, (_, i) => sale(`other-${i}`, `2026-10-02T08:${String(i).padStart(2, "0")}:00Z`)),
      sale("active", "2026-10-03T10:00:00Z", { clientBillId: "shared" }),
      sale("cancelled", "2026-09-01T10:00:00Z", { clientBillId: "shared", status: "cancelled" }),
    ]);
    const result = await loadRecentDashboardBills(); expect(result).toHaveLength(10); expect(result.map((r) => r.id)).not.toContain("active");
    // The page merges local rows with an API cache. Preserve cancellation
    // identity markers through that merge so an old active API row stays hidden.
    const localWithMarkers = await loadRecentDashboardBills(10, true);
    const staleApi = sale("active", "2026-10-03T10:00:00Z", { clientBillId: "shared" });
    const merged = dedupeBillsForDisplay([staleApi, ...localWithMarkers])
      .filter((bill) => !String(bill.status).toLowerCase().includes("cancel"));
    expect(merged.map((bill) => bill.id)).not.toContain("active");
  });
  it("keeps older date spellings and legacy duplicate decisions", async () => {
    await dexieDB.table("bills").bulkPut([
      sale("local", "2026-10-01T10:00:00Z", { clientBillId: undefined, sync_status: "pending_sync", local_id: "local" }),
      sale("server", "2026-10-01T10:00:00Z", { clientBillId: undefined, server_id: "server", local_id: "local" }),
      row("snake", { billType: "sale", status: "completed", billNo: "snake", client_bill_id: "durable-snake", created_at: "2026-10-02T10:00:00Z" }),
    ]);
    const scans = vi.spyOn(offlineDB, "getAll");
    expect((await loadRecentDashboardBills()).map((r) => r.id)).toEqual(["snake", "server"]); expect(scans).toHaveBeenCalledWith("bills");
  });
});

describe("customer detail", () => {
  it("loads one linked customer and one ledger once, including legacy references and pending payments", async () => {
    await dexieDB.table("customers").bulkPut([row("customer-a", { name: "Ramesh", serverId: "server-a" }), row("other", { name: "Other" })]);
    await dexieDB.table("id_mappings").bulkPut([
      { local_id: "draft-a", server_id: "customer-a", entity_type: "customer", tenant_id: "shop-a", store_id: "store-a" },
      { local_id: "wrong", server_id: "draft-a", entity_type: "bill", tenant_id: "shop-a", store_id: "store-a" },
    ]);
    await dexieDB.table("customer_ledger").bulkPut([
      row("ledger-bill", { customer_id: "draft-a", source_type: "bill", source_id: "bill-a", type: "BILL", amount: 100 }),
      row("ledger-pay", { customerId: "server-a", source_type: "payment", source_id: "pay-a", type: "PAYMENT", amount: 25, mode: "cash", sync_status: "pending_sync" }),
      row("wrong-ledger", { customerId: "other", customer_id: "server-a", source_type: "bill", source_id: "wrong", type: "BILL", amount: 999 }),
    ]);
    await dexieDB.table("bills").bulkPut([sale("bill-a", "2026-10-01T10:00:00Z", { local_customer_id: "draft-a" }), sale("other-bill", "2026-10-01T10:00:00Z", { customerId: "other" })]);
    await dexieDB.table("payments").put(row("pay-a", { serverCustomerId: "server-a", amount: 25, mode: "cash" }));
    await dexieDB.table("local_audit_logs").put(row("audit-a", { entity_id: "customer-a" }));
    const scans = vi.spyOn(offlineDB, "getAll"), reads = vi.spyOn(offlineDB, "getWhere");
    const detail = await loadCustomerDetail("draft-a");
    expect(detail?.customer.id).toBe("customer-a"); expect(detail?.customer.ledgerBalance).toBe(75); expect(detail?.customer.hasUnsyncedLedgerEntries).toBe(true);
    expect(detail?.bills.map((b) => b.id)).toEqual(["bill-a"]); expect(detail?.payments).toHaveLength(1); expect(detail?.audit.map((a) => a.id)).toEqual(["audit-a"]);
    expect(scans).not.toHaveBeenCalled(); expect(reads.mock.calls.filter(([table]) => table === "customer_ledger")).toHaveLength(1);
    expect(await loadCustomerDetail("wrong")).toBeNull();
  });
  it("retains the global manual-adjustment duplicate decision", async () => {
    await dexieDB.table("customers").put(row("customer-a", { name: "Ramesh" }));
    await dexieDB.table("customer_ledger").bulkPut([
      row("adjust-local", { customerId: "customer-a", source_type: "manual_adjustment", type: "ADJUSTMENT", amount: 10, clientLedgerId: "adj-1", sync_status: "pending_sync" }),
      row("adjust-server", { customerId: "other", source_type: "manual_adjustment", type: "ADJUSTMENT", amount: 10, clientLedgerId: "adj-1", server_id: "server-adj" }),
    ]);
    const scans = vi.spyOn(offlineDB, "getAll"); expect((await loadCustomerDetail("customer-a"))?.ledger).toEqual([]); expect(scans).toHaveBeenCalledWith("customer_ledger");
  });
  it("recovers a ledger-only customer with numeric or older customer references", async () => {
    await dexieDB.table("customer_ledger").put(row("legacy-ledger", { serverCustomerId: 123, source_type: "bill", type: "BILL", amount: 60, customerName: "Recovered" }));
    expect((await loadCustomerDetail("123"))?.customer).toMatchObject({ id: "123", name: "Recovered", ledgerBalance: 60, ledger_only: true });
  });
});

it("skips unrelated events while preserving sync and restore refreshes", () => {
  expect(dashboardChangeAffects({ type: "expense" }, "bills")).toBe(false);
  expect(dashboardChangeAffects({ entityType: "supplier" }, "products")).toBe(false);
  expect(dashboardChangeAffects({ type: "payment" }, "bills")).toBe(true);
  expect(dashboardChangeAffects({ entityType: "product" }, "products")).toBe(true);
  expect(dashboardChangeAffects({ type: "sync" }, "bills")).toBe(true);
  expect(dashboardChangeAffects({ action: "restore" }, "products")).toBe(true);
  expect(dashboardChangeAffects({ type: "restore" }, "bills")).toBe(true);
  expect(dashboardChangeAffects({ type: "unknown-import" }, "products")).toBe(true);
  expect(dashboardChangeAffects({ type: "products" }, "bills")).toBe(true);
  expect(dashboardChangeAffects({ type: "settings" }, "bills")).toBe(false);
});


it.each(["all", "many", "where"])("captures the shop before opening storage for %s reads", async (kind) => {
  dexieDB.close();
  vi.spyOn(dexieDB, "open").mockImplementationOnce(async () => { session.store_id = "store-b"; return dexieDB; });
  const result = kind === "all" ? offlineDB.getAll("customers")
    : kind === "many" ? offlineDB.getMany("customers", ["id"])
    : offlineDB.getWhere("customers", "_read_customer_ids", ["id"]);
  await expect(result).rejects.toThrow("different shop");
});


it("rebuilds balances and orphan cleanup from a shared snapshot", async () => {
  await dexieDB.table("customers").put(row("customer-a", { name: "Ramesh", udharAmount: 0, serverId: "server-a" }));
  await dexieDB.table("id_mappings").put({ local_id: "draft-a", server_id: "server-a", entity_type: "customer", tenant_id: "shop-a", store_id: "store-a" });
  await dexieDB.table("customer_ledger").put(row("l-bill", { customerId: "draft-a", source_id: "b-1", source_type: "bill", type: "BILL", amount: 100 }));
  await dexieDB.table("bills").put(sale("b-1", "2026-10-01T10:00:00Z"));
  await dexieDB.table("payments").bulkPut([row("valid-pay", { billId: "b-1" }), row("orphan", { billId: "missing" })]);
  const reads = vi.spyOn(offlineDB, "getAll");
  await refreshBusinessCaches();
  expect((await dexieDB.table("customers").get("customer-a")).udharAmount).toBe(100);
  expect(await dexieDB.table("payments").get("orphan")).toBeUndefined();
  expect(reads.mock.calls).toHaveLength(6); // three financial reads use the locked Dexie transaction directly
  const cachedCustomer = vi.mocked(writeInstantCache).mock.calls.find(([key]) => key === "customers")?.[1];
  expect(cachedCustomer).toEqual([expect.objectContaining({ id: "customer-a", udharAmount: 100 })]);
});

it("preserves a payment queued during a derived balance write", async () => {
  await dexieDB.table("customers").put(row("customer-a", { name: "Ramesh", udharAmount: 0 }));
  await dexieDB.table("customer_ledger").put(row("l-bill", { customerId: "customer-a", source_id: "b-1", source_type: "bill", type: "BILL", amount: 100 }));
  // Queue a separate payment precisely after the old sum was calculated and
  // before its customer write. The financial transaction must serialize it.
  // Transaction-bound tables are distinct instances; intercept their shared prototype.
  const table = Object.getPrototypeOf(dexieDB.customers) as typeof dexieDB.customers;
  const put = table.put;
  let payment: Promise<unknown> | undefined;
  vi.spyOn(table, "put").mockImplementation(function (this: typeof dexieDB.customers, value, key) {
    if (this.name === "customers" && value.udharAmount === 100 && !payment) {
      payment = Dexie.ignoreTransaction(() => dexieDB.transaction("rw", [dexieDB.customers, dexieDB.customer_ledger], async () => {
        await dexieDB.table("customer_ledger").put(row("l-payment", { customerId: "customer-a", source_id: "p-1", source_type: "payment", type: "PAYMENT", amount: 25 }));
        await dexieDB.table("customers").update("customer-a", { udharAmount: 75 });
      }));
      // Simulate a delayed write after calculation. Keep a real transaction
      // alive while yielding; without its lock the payment commits first.
      return Dexie.waitFor(new Promise<void>((resolve) => setTimeout(resolve, 20)))
        .then(() => put.call(this, value, key));
    }
    return put.call(this, value, key);
  });
  await refreshBusinessCaches();
  expect(payment).toBeDefined();
  await payment;
  expect((await dexieDB.table("customers").get("customer-a")).udharAmount).toBe(75);
});


it.each([1, 2, 3, 4, 5, 6, 7])("preserves every historical table/index for version %s", (number) => {
  const versions = (dexieDB as unknown as { _versions: Array<{ _cfg: { version: number; dbschema: Record<string, { primKey: { src: string }; indexes: Array<{ src: string }> }> } }> })._versions;
  const schema = versions.find((version) => version._cfg.version === number)!._cfg.dbschema;
  expect(Object.keys(schema).sort()).toEqual(Object.keys(historicalSchemas[number]).sort());
  for (const [table, expected] of Object.entries(historicalSchemas[number])) {
    expect([schema[table].primKey.src, ...schema[table].indexes.map((index) => index.src)])
      .toEqual(expected.split(",").map((key) => key.trim()));
  }
});
