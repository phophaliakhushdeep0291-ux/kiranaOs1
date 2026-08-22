import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CustomerInput } from "@/types/api";

const mockState = vi.hoisted(() => ({
  idCounter: 0,
  customers: [] as Array<Record<string, unknown>>,
  committed: {
    customers: [] as Array<Record<string, unknown>>,
    local_audit_logs: [] as Array<Record<string, unknown>>,
    sync_outbox: [] as Array<Record<string, unknown>>,
    bills: [] as Array<Record<string, unknown>>,
    customer_ledger: [] as Array<Record<string, unknown>>,
    payments: [] as Array<Record<string, unknown>>,
  },
  failOnStore: null as string | null,
  lastTables: [] as string[],
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => {
      if (storeName === "customers") return mockState.customers;
      if (storeName === "bills") return mockState.committed.bills;
      if (storeName === "customer_ledger") return mockState.committed.customer_ledger;
      if (storeName === "payments") return mockState.committed.payments;
      return [];
    }),
    put: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
    transaction: vi.fn(async (tables: string[], callback: (tx: {
      put: (storeName: string, value: unknown) => Promise<void>;
      putMany: (storeName: string, values: unknown[]) => Promise<void>;
      enqueueOutboxOperation: (event: unknown) => Promise<void>;
      setSetting: (key: string, value: unknown, expiresAt?: number | null) => Promise<void>;
    }) => Promise<unknown>) => {
      mockState.lastTables = tables;
      const pending = {
        customers: [] as Array<Record<string, unknown>>,
        local_audit_logs: [] as Array<Record<string, unknown>>,
        sync_outbox: [] as Array<Record<string, unknown>>,
        bills: [] as Array<Record<string, unknown>>,
        customer_ledger: [] as Array<Record<string, unknown>>,
        payments: [] as Array<Record<string, unknown>>,
      };
      const tx = {
        put: vi.fn(async (storeName: string, value: unknown) => {
          if (mockState.failOnStore === storeName) throw new Error(`forced ${storeName} failure`);
          if (storeName in pending) pending[storeName as keyof typeof pending].push(value as Record<string, unknown>);
        }),
        putMany: vi.fn(async (storeName: string, values: unknown[]) => {
          if (mockState.failOnStore === storeName) throw new Error(`forced ${storeName} failure`);
          if (storeName in pending) pending[storeName as keyof typeof pending].push(...values as Array<Record<string, unknown>>);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
          if (mockState.failOnStore === "sync_outbox") throw new Error("forced sync_outbox failure");
          pending.sync_outbox.push(event as Record<string, unknown>);
        }),
        setSetting: vi.fn(async () => undefined),
      };
      const result = await callback(tx);
      mockState.committed.customers.push(...pending.customers);
      mockState.committed.local_audit_logs.push(...pending.local_audit_logs);
      mockState.committed.sync_outbox.push(...pending.sync_outbox);
      mockState.committed.bills.push(...pending.bills);
      mockState.committed.customer_ledger.push(...pending.customer_ledger);
      mockState.committed.payments.push(...pending.payments);
      return result;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_test_${++mockState.idCounter}`),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
}));

import { offlineDB } from "@/lib/offline/db";
import { removeCachedListItem, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/core/customers/local-actions";
import { restoreEntityFromRecycleBinLocalFirst } from "@/features/core/recycle-bin/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

const baseCustomerInput: CustomerInput = {
  name: "Ramesh",
  mobile: "9876543210",
  type: "udhar",
  address: "Jodhpur",
  udharLimit: 5000,
  notes: "Wholesale buyer",
};

const existingCustomer = {
  id: "customer_1",
  local_id: "customer_1",
  server_id: "server_customer_1",
  name: "Ramesh",
  mobile: "9876543210",
  type: "udhar",
  address: "Jodhpur",
  udharAmount: 300,
  totalUdhar: 300,
  createdAt: "2026-06-05T09:00:00.000Z",
  updatedAt: "2026-06-05T09:00:00.000Z",
  sync_status: "synced",
};

function resetCommitted() {
  mockState.committed.customers = [];
  mockState.committed.local_audit_logs = [];
  mockState.committed.sync_outbox = [];
  mockState.committed.bills = [];
  mockState.committed.customer_ledger = [];
  mockState.committed.payments = [];
}

describe("customer local-first write safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.idCounter = 0;
    mockState.customers = [{ ...existingCustomer }];
    mockState.failOnStore = null;
    mockState.lastTables = [];
    resetCommitted();
  });

  it("creates customer offline with customer row, audit log, and outbox in one transaction", async () => {
    const customer = await createCustomerLocalFirst({ ...baseCustomerInput, mobile: "9123456789" });

    expect(customer).toEqual(expect.objectContaining({ name: "Ramesh", sync_status: "pending_sync" }));
    expect(mockedOfflineDB.transaction).toHaveBeenCalledTimes(1);
    expect(mockState.lastTables).toEqual(expect.arrayContaining(["customers", "local_audit_logs", "sync_outbox"]));
    expect(mockState.committed.customers).toHaveLength(1);
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "customer_created", entity_type: "customer", entity_id: customer.id }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "CREATE_CUSTOMER", entity_type: "customer", entity_id: customer.id }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("customers", expect.objectContaining({ id: customer.id }), 1000);
  });

  it("updates customer offline with audit log and outbox in the same transaction", async () => {
    const updated = await updateCustomerLocalFirst("customer_1", { ...baseCustomerInput, name: "Ramesh Kirana" });

    expect(updated).toEqual(expect.objectContaining({ id: "customer_1", name: "Ramesh Kirana", sync_status: "pending_sync" }));
    expect(mockState.lastTables).toEqual(expect.arrayContaining(["customers", "local_audit_logs", "sync_outbox"]));
    expect(mockState.committed.customers[0]).toEqual(expect.objectContaining({ id: "customer_1", name: "Ramesh Kirana" }));
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "customer_edited", entity_id: "customer_1" }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "UPDATE_CUSTOMER", entity_id: "customer_1" }),
    ]));
  });

  it("blocks customer delete before local writes when owner PIN is missing", async () => {
    await expect(deleteCustomerLocalFirst({ id: "customer_1", ownerPin: "", reason: "Duplicate customer" })).rejects.toThrow(/Owner PIN/i);

    expect(mockedOfflineDB.getAll).not.toHaveBeenCalled();
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockState.committed.customers).toHaveLength(0);
    expect(mockState.committed.local_audit_logs).toHaveLength(0);
    expect(mockState.committed.sync_outbox).toHaveLength(0);
  });

  it("soft deletes customer only and keeps bills, ledger, and payments untouched", async () => {
    const result = await deleteCustomerLocalFirst({ id: "customer_1", ownerPin: "1234", reason: "Duplicate customer" });

    expect(result.success).toBe(true);
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockState.lastTables).toEqual(["customers", "local_audit_logs", "sync_outbox"]);
    expect(mockState.committed.customers[0]).toEqual(expect.objectContaining({
      id: "customer_1",
      deletedAt: expect.any(String),
      deleted_at: expect.any(String),
      deleteReason: "Duplicate customer",
      sync_status: "pending_sync",
    }));
    expect(mockState.committed.bills).toHaveLength(0);
    expect(mockState.committed.customer_ledger).toHaveLength(0);
    expect(mockState.committed.payments).toHaveLength(0);
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("customers", "customer_1");
  });

  it("creates audit log and outbox operation for customer delete", async () => {
    await deleteCustomerLocalFirst({ id: "customer_1", ownerPin: "1234", reason: "Duplicate customer" });

    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "customer_deleted",
        entity_type: "customer",
        entity_id: "customer_1",
        reason: "Duplicate customer",
        owner_pin_provided: true,
      }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "DELETE_CUSTOMER_PENDING",
        entity_type: "customer",
        entity_id: "customer_1",
        idempotency_key: "delete-customer:customer_1",
        payload: expect.objectContaining({
          customerId: "customer_1",
          localCustomerId: "customer_1",
          serverCustomerId: "server_customer_1",
          reason: "Duplicate customer",
          ownerPinProvided: true,
        }),
      }),
    ]));
  });

  it("restores customer with customer row, audit log, and outbox operation in one transaction", async () => {
    mockState.customers = [{ ...existingCustomer, deletedAt: "2026-06-05T10:00:00.000Z", deleted_at: "2026-06-05T10:00:00.000Z" }];

    const restored = await restoreEntityFromRecycleBinLocalFirst("customer", "customer_1", "1234", "Mistaken delete");

    expect(restored).toEqual(expect.objectContaining({ id: "customer_1", deletedAt: null, deleted_at: null, sync_status: "pending_sync" }));
    expect(mockState.lastTables).toEqual(["customers", "local_audit_logs", "sync_outbox"]);
    expect(mockState.committed.customers[0]).toEqual(expect.objectContaining({ id: "customer_1", deletedAt: null, deleted_at: null }));
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "customer_restored", entity_type: "customer", entity_id: "customer_1", reason: "Mistaken delete", owner_pin_provided: true }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "RESTORE_CUSTOMER_PENDING", entity_type: "customer", entity_id: "customer_1" }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("customers", expect.objectContaining({ id: "customer_1" }), 1000);
    expect(mockState.committed.bills).toHaveLength(0);
    expect(mockState.committed.customer_ledger).toHaveLength(0);
    expect(mockState.committed.payments).toHaveLength(0);
  });

  it("rolls back customer write when audit or outbox insert fails", async () => {
    mockState.failOnStore = "local_audit_logs";

    await expect(createCustomerLocalFirst({ ...baseCustomerInput, mobile: "9123456789" })).rejects.toThrow(/forced local_audit_logs failure/i);

    expect(mockState.committed.customers).toHaveLength(0);
    expect(mockState.committed.local_audit_logs).toHaveLength(0);
    expect(mockState.committed.sync_outbox).toHaveLength(0);
    expect(mockedUpsertCachedListItem).not.toHaveBeenCalled();
  });
});
