import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { dedupeLedgerEntries, type CustomerLedgerEntry } from "@/features/core/ledger/accounting";

/**
 * Collecting a payment read every customer, every id mapping and the whole
 * customer ledger to find one customer's entries. The ledger and the mappings
 * grow with every sale and are never pruned. The indexed reads must return
 * exactly what the full reads returned, so each case below is compared with a
 * copy of the old algorithm run over the same rows.
 */
type Row = Record<string, unknown>;
const db = vi.hoisted(() => ({ tables: {} as Record<string, Row[]>, fullReads: [] as string[] }));
const PRIMARY_KEY: Record<string, string> = { id_mappings: "local_id" };

vi.mock("@/lib/offline/db", () => {
  const ordered = (table: string) => [...(db.tables[table] ?? [])]
    .sort((a, b) => String(a[PRIMARY_KEY[table] ?? "id"]).localeCompare(String(b[PRIMARY_KEY[table] ?? "id"])));
  return {
    offlineDB: {
      getAll: vi.fn(async (table: string) => { db.fullReads.push(table); return ordered(table); }),
      getMany: vi.fn(async (table: string, ids: string[]) => ordered(table).filter((row) => ids.includes(row[PRIMARY_KEY[table] ?? "id"] as string))),
      getWhere: vi.fn(async (table: string, field: string, values: string[]) => ordered(table).filter((row) => values.includes(row[field] as string))),
    },
  };
});

import { readCustomerLedgerEntries } from "@/features/core/ledger/local-actions";

/** The pre-index implementation, verbatim in behaviour. */
function readByFullScan(customerId: string): CustomerLedgerEntry[] {
  const all = (table: string) => [...(db.tables[table] ?? [])].sort((a, b) =>
    String(a[PRIMARY_KEY[table] ?? "id"]).localeCompare(String(b[PRIMARY_KEY[table] ?? "id"])));
  const identity = (row?: Row) => new Set([row?.id, row?.local_id, row?.localId, row?.server_id, row?.serverId]
    .filter((value): value is string => typeof value === "string" && value.length > 0));
  const expand = (ids: Set<string>) => {
    const expanded = new Set(ids);
    for (let changed = true; changed;) {
      changed = false;
      for (const mapping of all("id_mappings")) {
        const type = String(mapping.entity_type ?? "");
        if (type && type !== "customer" && type !== "customers") continue;
        const local = mapping.local_id as string, server = mapping.server_id as string;
        if (expanded.has(local) && !expanded.has(server)) { expanded.add(server); changed = true; }
        if (expanded.has(server) && !expanded.has(local)) { expanded.add(local); changed = true; }
      }
    }
    return expanded;
  };
  const customer = all("customers").find((row) => expand(identity(row)).has(customerId));
  const ids = new Set([customerId, ...expand(identity(customer))]);
  return dedupeLedgerEntries(all("customer_ledger") as unknown as CustomerLedgerEntry[]).filter((row) => {
    const id = row.customerId ?? row.customer_id;
    return typeof id === "string" && ids.has(id);
  });
}

const entry = (id: string, customer: Row, extra: Row = {}): Row => ({
  id, ...customer, type: "BILL", source_type: "bill", amount: 100, sync_status: "synced",
  created_at: "2026-10-01T10:00:00Z", entry_at: "2026-10-01T10:00:00Z", ...extra,
});

beforeEach(() => {
  db.fullReads = [];
  db.tables = {
    customers: [
      { id: "cust_local_1", local_id: "cust_local_1", server_id: "cust_srv_1", name: "Ramesh" },
      { id: "cust_other", name: "Suresh" },
    ],
    id_mappings: [
      { local_id: "cust_local_1", server_id: "cust_srv_1", entity_type: "customer" },
      { local_id: "cust_draft_1", server_id: "cust_local_1", entity_type: "customer" }, // a second hop
      { local_id: "bill_local_9", server_id: "cust_local_1", entity_type: "bill" }, // wrong entity type
    ],
    customer_ledger: [
      entry("led_a", { customerId: "cust_local_1" }, { source_id: "bill_1", sync_status: "pending_sync" }),
      // The synced echo of led_a under the same customer id wins de-duplication.
      entry("led_b", { customerId: "cust_local_1", server_id: "srv_led_b" }, { source_id: "bill_1" }),
      entry("led_c", { customer_id: "cust_srv_1" }, { source_id: "bill_2", amount: 40 }),
      entry("led_d", { customerId: "cust_draft_1" }, { type: "PAYMENT", source_type: "payment", source_id: "pay_1", amount: 25 }),
      // customerId wins over customer_id, so this one belongs to someone else.
      entry("led_e", { customerId: "cust_other", customer_id: "cust_srv_1" }, { source_id: "bill_3" }),
      entry("led_f", { customerId: "cust_other" }, { source_id: "bill_4" }),
      entry("led_g", { customerId: "cust_srv_1" }, { source_id: "bill_5", deleted_at: "2026-10-01T11:00:00Z" }),
      entry("led_h", { customerId: "bill_local_9" }, { source_id: "bill_6" }),
    ],
  };
});

describe("one customer's ledger, read through the indexes", () => {
  it.each(["cust_srv_1", "cust_local_1", "cust_draft_1", "cust_other", "unknown"])(
    "returns exactly the full-scan result for %s without reading the ledger or mappings in full",
    async (customerId) => {
      const expected = readByFullScan(customerId);
      db.fullReads = [];
      expect(await readCustomerLedgerEntries(customerId)).toEqual(expected);
      expect(db.fullReads).not.toContain("customer_ledger");
      expect(db.fullReads).not.toContain("id_mappings");
    },
  );

  it("falls back to the full ledger when the customer has a manual adjustment, and still agrees", async () => {
    db.tables.customer_ledger.push(
      entry("led_adj_local", { customerId: "cust_local_1" }, { type: "ADJUSTMENT", source_type: "adjustment", clientLedgerId: "adj_1", sync_status: "pending_sync", amount: 10 }),
      // Its server echo is filed under an id this customer cannot reach.
      entry("led_adj_echo", { customerId: "cust_unmapped" }, { type: "DEBIT", mode: "adjustment", clientLedgerId: "adj_1", server_id: "srv_adj", amount: 10 }),
    );
    const expected = readByFullScan("cust_srv_1");
    db.fullReads = [];
    expect(await readCustomerLedgerEntries("cust_srv_1")).toEqual(expected);
    expect(db.fullReads).toContain("customer_ledger");
  });
});

describe("single-record lookups read one record", () => {
  const source = (path: string) => readFileSync(`src/features/core/${path}`, "utf8");
  const body = (text: string, signature: string) => text.slice(text.indexOf(signature), text.indexOf("\n}\n", text.indexOf(signature)));

  it("editing or cancelling a bill finds it through the bill indexes", () => {
    const find = body(source("bills/edit-actions.ts"), "async function findLocalBill(");
    expect(find).not.toMatch(/getAll<[^>]*>\("bills"\)/);
    expect(find).toContain('offlineDB.getMany<AnyRow>("bills", [id])');
  });

  it("deleting a customer finds it by its three indexed ids", () => {
    const remove = body(source("customers/local-actions.ts"), "export async function deleteCustomerLocalFirst(");
    expect(remove).not.toMatch(/getAll<[^>]*>\("customers"\)/);
    expect(remove).toContain('offlineDB.getWhere<CustomerLocalRecord>("customers", "server_id", [id])');
  });

  it("collecting a payment no longer reads the ledger or id mappings in full", () => {
    const ledger = source("ledger/local-actions.ts");
    expect(ledger).not.toMatch(/getAll<[^>]*>\("id_mappings"\)/);
    expect(ledger).toContain('offlineDB.getWhere<CustomerLedgerEntry>("customer_ledger", "customerId", ids)');
  });
});
