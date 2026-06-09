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
          if (storeName in pending) pending[storeName as keyof typeof pending].push(value as Record<string, unknown>);
        }),
        putMany: vi.fn(async (storeName: string, values: unknown[]) => {
          if (storeName in pending) pending[storeName as keyof typeof pending].push(...values as Array<Record<string, unknown>>);
        }),
        enqueueOutboxOperation: vi.fn(async (event: unknown) => {
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
  createLocalId: vi.fn((prefix: string) => `${prefix}_reliability_${++mockState.idCounter}`),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
}));

import { offlineDB } from "@/lib/offline/db";
import { removeCachedListItem, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { createCustomerLocalFirst, deleteCustomerLocalFirst, updateCustomerLocalFirst } from "@/features/customers/local-actions";
import { findDuplicateCustomerWarnings } from "@/features/customers/customer-reliability";
import { restoreEntityFromRecycleBinLocalFirst } from "@/features/recycle-bin/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

const baseCustomerInput: CustomerInput = {
  name: "Ramesh Kirana",
  mobile: "9876543210",
  type: "udhar",
  address: "Shop 12 Sardarpura Jodhpur",
  udharLimit: 5000,
  notes: "Pays monthly",
};

const existingCustomer = {
  id: "customer_ramesh",
  local_id: "customer_ramesh",
  server_id: "server_customer_ramesh",
  name: "Ramesh Kirana Store",
  mobile: "9876543210",
  type: "udhar",
  address: "Shop No 12, Sardarpura, Jodhpur",
  udharAmount: 800,
  totalUdhar: 800,
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:00:00.000Z",
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

describe("customer reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.idCounter = 0;
    mockState.customers = [{ ...existingCustomer }];
    mockState.lastTables = [];
    resetCommitted();
  });

  it("customer create works offline", async () => {
    const created = await createCustomerLocalFirst({ ...baseCustomerInput, mobile: "9123456789" });

    expect(created).toEqual(expect.objectContaining({
      id: "customer_reliability_1",
      local_id: "customer_reliability_1",
      name: "Ramesh Kirana",
      sync_status: "pending_sync",
    }));
    expect(mockedOfflineDB.transaction).toHaveBeenCalledTimes(1);
    expect(mockState.lastTables).toEqual(expect.arrayContaining(["customers", "local_audit_logs", "sync_outbox"]));
    expect(mockState.committed.customers).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, name: "Ramesh Kirana" }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "CREATE_CUSTOMER", entity_type: "customer", entity_id: created.id }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("customers", expect.objectContaining({ id: created.id }), 1000);
  });

  it("customer update works offline", async () => {
    const updated = await updateCustomerLocalFirst("customer_ramesh", {
      ...baseCustomerInput,
      name: "Ramesh Wholesale",
      mobile: "9876543210",
    });

    expect(updated).toEqual(expect.objectContaining({
      id: "customer_ramesh",
      name: "Ramesh Wholesale",
      sync_status: "pending_sync",
    }));
    expect(mockState.committed.customers[0]).toEqual(expect.objectContaining({ id: "customer_ramesh", name: "Ramesh Wholesale" }));
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "customer_edited", entity_id: "customer_ramesh" }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "UPDATE_CUSTOMER", entity_id: "customer_ramesh" }),
    ]));
  });

  it("duplicate customer detected by mobile", () => {
    const warnings = findDuplicateCustomerWarnings(
      { name: "Different Buyer", mobile: "+91 98765 43210", address: "Paota" },
      [existingCustomer],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        customerId: "customer_ramesh",
        reason: "mobile",
        matchedFields: ["mobile"],
        message: expect.stringMatching(/duplicate customer/i),
      }),
    ]));
  });

  it("possible duplicate detected by name + address similarity", () => {
    const warnings = findDuplicateCustomerWarnings(
      { name: "Ramesh Kirana", mobile: "9123456789", address: "Sardarpura Jodhpur Shop 12" },
      [existingCustomer],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        customerId: "customer_ramesh",
        reason: "name_address_similarity",
        matchedFields: ["name", "address"],
        message: expect.stringMatching(/possible duplicate/i),
      }),
    ]));
  });

  it("customer delete requires owner PIN", async () => {
    await expect(deleteCustomerLocalFirst({ id: "customer_ramesh", ownerPin: "", reason: "Duplicate" })).rejects.toThrow(/Owner PIN/i);

    expect(mockedOfflineDB.getAll).not.toHaveBeenCalled();
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    expect(mockState.committed.customers).toHaveLength(0);
    expect(mockState.committed.local_audit_logs).toHaveLength(0);
    expect(mockState.committed.sync_outbox).toHaveLength(0);
  });

  it("customer delete is soft delete only", async () => {
    await deleteCustomerLocalFirst({ id: "customer_ramesh", ownerPin: "1234", reason: "Duplicate" });

    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockState.committed.customers[0]).toEqual(expect.objectContaining({
      id: "customer_ramesh",
      deletedAt: expect.any(String),
      deleted_at: expect.any(String),
      deleteReason: "Duplicate",
      sync_status: "pending_sync",
    }));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "DELETE_CUSTOMER_PENDING", entity_type: "customer", entity_id: "customer_ramesh" }),
    ]));
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("customers", "customer_ramesh");
  });

  it("customer bills, ledger, and payments remain after delete", async () => {
    const existingBill = { id: "bill_1", customerId: "customer_ramesh", total: 800 };
    const existingLedger = { id: "ledger_1", customer_id: "customer_ramesh", type: "BILL", amount: 800 };
    const existingPayment = { id: "payment_1", customer_id: "customer_ramesh", amount: 200 };
    mockState.committed.bills = [existingBill];
    mockState.committed.customer_ledger = [existingLedger];
    mockState.committed.payments = [existingPayment];

    await deleteCustomerLocalFirst({ id: "customer_ramesh", ownerPin: "1234", reason: "Customer inactive" });

    expect(mockState.committed.bills).toEqual([existingBill]);
    expect(mockState.committed.customer_ledger).toEqual([existingLedger]);
    expect(mockState.committed.payments).toEqual([existingPayment]);
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
  });

  it("restore creates audit log", async () => {
    mockState.customers = [{ ...existingCustomer, deletedAt: "2026-06-06T10:00:00.000Z", deleted_at: "2026-06-06T10:00:00.000Z" }];

    await restoreEntityFromRecycleBinLocalFirst("customer", "customer_ramesh", "1234", "Wrong customer deleted");

    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "customer_restored",
        entity_type: "customer",
        entity_id: "customer_ramesh",
        reason: "Wrong customer deleted",
        owner_pin_provided: true,
      }),
    ]));
  });

  it("restore creates outbox operation", async () => {
    mockState.customers = [{ ...existingCustomer, deletedAt: "2026-06-06T10:00:00.000Z", deleted_at: "2026-06-06T10:00:00.000Z" }];

    const restored = await restoreEntityFromRecycleBinLocalFirst("customer", "customer_ramesh", "1234", "Wrong customer deleted");

    expect(restored).toEqual(expect.objectContaining({ id: "customer_ramesh", deletedAt: null, deleted_at: null, sync_status: "pending_sync" }));
    expect(mockState.lastTables).toEqual(["customers", "local_audit_logs", "sync_outbox"]);
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "RESTORE_CUSTOMER_PENDING", entity_type: "customer", entity_id: "customer_ramesh" }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("customers", expect.objectContaining({ id: "customer_ramesh" }), 1000);
  });
});
