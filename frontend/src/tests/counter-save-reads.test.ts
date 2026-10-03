import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/offline/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/offline/context")>()),
  getOfflineScope: () => ({ tenant_id: "shop-a", store_id: "store-a", device_id: "counter-1" }),
}));

import { dexieDB, offlineDB } from "@/lib/offline/db";
import { localChangeAffectsExpenses } from "@/features/core/expenses/overview";

type Row = Record<string, unknown>;
const mine = (id: string, extra: Row = {}): Row => ({ id, tenant_id: "shop-a", store_id: "store-a", ...extra });
const theirs = (id: string, extra: Row = {}): Row => ({ id, tenant_id: "shop-b", store_id: "store-b", ...extra });

/** A Dexie table stand-in that records how it was read. */
function fakeTable(rows: Row[]) {
  const reads: string[] = [];
  return {
    reads,
    bulkGet: vi.fn(async (keys: string[]) => { reads.push(`bulkGet:${keys.join(",")}`); return keys.map((key) => rows.find((row) => row.id === key)); }),
    failIndex: undefined as string | undefined,
    where: vi.fn(function (this: { failIndex?: string }, field: string) {
      const failing = this.failIndex === field;
      return {
        anyOf: (values: string[]) => ({
          toArray: async () => {
            reads.push(`where:${field}`);
            if (failing) throw new Error(`index ${field} unavailable`);
            return rows.filter((row) => values.includes(row[field] as string));
          },
        }),
        // getAll's own read: every row of the current shop.
        equals: ([tenant, store]: [string, string]) => ({
          toArray: async () => { reads.push(`scan:${field}`); return rows.filter((row) => row.tenant_id === tenant && row.store_id === store); },
        }),
      };
    }),
    toArray: vi.fn(async () => { reads.push("toArray"); return rows; }),
  };
}

describe("targeted offline reads", () => {
  let table: ReturnType<typeof fakeTable>;
  beforeEach(() => {
    vi.spyOn(dexieDB, "open").mockResolvedValue(dexieDB);
    // Ids are unique in a real table; another shop's row can still share an indexed value.
    table = fakeTable([mine("p-2"), mine("p-1", { barcode: "890" }), mine("p-3", { local_id: "local-3" }), theirs("p-4", { local_id: "local-3" })]);
    vi.spyOn(dexieDB, "table").mockReturnValue(table as never);
  });
  afterEach(() => vi.restoreAllMocks());

  it("reads only the requested ids, never the whole table", async () => {
    const rows = await offlineDB.getMany<Row>("products", ["p-2", "p-1", "missing", "p-2", undefined, ""]);
    expect(rows.map((row) => row.id)).toEqual(["p-1", "p-2"]);
    expect(table.reads).toEqual(["bulkGet:p-2,p-1,missing"]);
  });

  it("drops another shop's row exactly as getAll does", async () => {
    const shared = fakeTable([theirs("p-1")]);
    vi.mocked(dexieDB.table).mockReturnValue(shared as never);
    expect(await offlineDB.getMany<Row>("products", ["p-1"])).toEqual([]);
  });

  it("looks rows up through an index and keeps the shop boundary", async () => {
    const rows = await offlineDB.getWhere<Row>("products", "local_id", ["local-3"]);
    expect(rows.map((row) => row.id)).toEqual(["p-3"]);
    expect(table.reads).toEqual(["where:local_id"]);
  });

  it("falls back to a scan of this shop's rows when an index read fails, as getAll does", async () => {
    table.failIndex = "local_id";
    const rows = await offlineDB.getWhere<Row>("products", "local_id", ["local-3"]);
    expect(rows.map((row) => row.id)).toEqual(["p-3"]);
    expect(table.reads).toEqual(["where:local_id", "scan:[tenant_id+store_id]"]);
  });

  it("does not touch storage for an empty request", async () => {
    expect(await offlineDB.getMany("products", [])).toEqual([]);
    expect(await offlineDB.getWhere("customers", "server_id", [null, undefined])).toEqual([]);
    expect(table.reads).toEqual([]);
  });
});

describe("bill identity index", () => {
  it("version 8 retains both spellings of the open-bill identity", () => {
    expect(dexieDB.verno).toBe(8);
    const indexes = dexieDB.table("bills").schema.idxByName;
    expect(Object.keys(indexes)).toEqual(expect.arrayContaining(["clientBillId", "client_bill_id"]));
  });

  it("a Save looks its open bill up through the index, not the whole bill history", () => {
    const billing = readFileSync("src/features/core/billing/local-actions.ts", "utf8");
    expect(billing).not.toMatch(/getAll<[^>]*>\("bills"\)/);
    expect(billing).toContain('offlineDB.getWhere<Row>("bills", "clientBillId", [clientBillId])');
    expect(billing).toContain('offlineDB.getWhere<Row>("bills", "client_bill_id", [clientBillId])');
  });
});

describe("expense page refreshes", () => {
  it("ignores changes to other records but not sync, restores or expenses", () => {
    for (const type of ["bill", "product", "ledger", "payment", "purchase", "inventory_lot"]) {
      expect(localChangeAffectsExpenses({ type })).toBe(false);
    }
    expect(localChangeAffectsExpenses({ type: "expense" })).toBe(true);
    expect(localChangeAffectsExpenses({ type: "sync" })).toBe(true);
    expect(localChangeAffectsExpenses({ action: "local-backup-restored" } as never)).toBe(true);
    expect(localChangeAffectsExpenses(undefined)).toBe(true);
  });
});

describe("counter save paths read only the rows they need", () => {
  const read = (path: string) => readFileSync(`src/features/core/${path}`, "utf8");
  const wholeTable = (table: string) => new RegExp(`getAll<[^>]*>\\("${table}"\\)`);

  it("a sale reads its own products and the named customer, not the whole tables", () => {
    const billing = read("billing/local-actions.ts");
    expect(billing).not.toMatch(wholeTable("products"));
    expect(billing).not.toMatch(wholeTable("customers"));
    expect(billing).toContain('offlineDB.getMany<Product>("products", ids)');
    expect(billing).toContain('offlineDB.getWhere<Row>("customers", "local_id", [customerId])');
  });

  it("returns and cancellations read only their lines' products", () => {
    expect(read("returns/local-actions.ts")).not.toMatch(wholeTable("products"));
    expect(read("bills/local-actions.ts")).toContain('getMany<Product & Record<string, unknown>>("products", productIds)');
  });

  it("editing, patching or deleting one product reads one product", () => {
    const products = read("products/local-actions.ts");
    expect(products.match(/getMany<Product>\("products", \[id\]\)/g)).toHaveLength(3);
    expect(products).not.toContain('rows.find((row) => row.id === id)');
  });
});
