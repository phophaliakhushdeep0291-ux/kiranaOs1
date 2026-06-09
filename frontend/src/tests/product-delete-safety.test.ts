import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductInput } from "@/types/api";

const mockState = vi.hoisted(() => ({
  idCounter: 0,
  products: [] as Array<Record<string, unknown>>,
  committed: {
    products: [] as Array<Record<string, unknown>>,
    local_audit_logs: [] as Array<Record<string, unknown>>,
    sync_outbox: [] as Array<Record<string, unknown>>,
  },
  failOnStore: null as string | null,
  lastTables: [] as string[],
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getAll: vi.fn(async (storeName: string) => {
      if (storeName === "products") return mockState.products;
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
        products: [] as Array<Record<string, unknown>>,
        local_audit_logs: [] as Array<Record<string, unknown>>,
        sync_outbox: [] as Array<Record<string, unknown>>,
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
      mockState.committed.products.push(...pending.products);
      mockState.committed.local_audit_logs.push(...pending.local_audit_logs);
      mockState.committed.sync_outbox.push(...pending.sync_outbox);
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
import { createProductLocalFirst, deleteProductLocalFirst, updateProductLocalFirst } from "@/features/products/local-actions";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

const baseProductInput: ProductInput = {
  name: "Aashirvaad Atta",
  category: "grocery",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "kg",
  rateUnit: "kg",
  stockBaseQty: 10,
  defaultPricePerRateUnit: 45,
  sellingPrice: 45,
  retailPrice: 45,
  wholesalePrice: 43,
  minimumSellingPrice: 40,
  lowStockThreshold: 2,
  isActive: true,
};

const existingProduct = {
  id: "product_1",
  local_id: "product_1",
  server_id: "server_product_1",
  name: "Aashirvaad Atta",
  category: "grocery",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "kg",
  rateUnit: "kg",
  stockBaseQty: 10,
  defaultPricePerRateUnit: 45,
  sellingPrice: 45,
  retailPrice: 45,
  wholesalePrice: 43,
  minimumSellingPrice: 40,
  createdAt: "2026-06-05T09:00:00.000Z",
  updatedAt: "2026-06-05T09:00:00.000Z",
  sync_status: "synced",
};

function resetCommitted() {
  mockState.committed.products = [];
  mockState.committed.local_audit_logs = [];
  mockState.committed.sync_outbox = [];
}

describe("product local-first write safety", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.idCounter = 0;
    mockState.products = [{ ...existingProduct }];
    mockState.failOnStore = null;
    mockState.lastTables = [];
    resetCommitted();
  });

  it("creates product offline with product row, audit log, and outbox in one transaction", async () => {
    const product = await createProductLocalFirst(baseProductInput);

    expect(product).toEqual(expect.objectContaining({ name: "Aashirvaad Atta", sync_status: "pending_sync" }));
    expect(mockedOfflineDB.transaction).toHaveBeenCalledTimes(1);
    expect(mockState.lastTables).toEqual(expect.arrayContaining(["products", "local_audit_logs", "sync_outbox"]));
    expect(mockState.committed.products).toHaveLength(1);
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "product_created", entity_type: "product", entity_id: product.id }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "CREATE_PRODUCT", entity_type: "product", entity_id: product.id }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("products", expect.objectContaining({ id: product.id }), 1000);
  });

  it("updates product offline with audit log and outbox in the same transaction", async () => {
    const updated = await updateProductLocalFirst("product_1", { ...baseProductInput, name: "Updated Atta", defaultPricePerRateUnit: 48 });

    expect(updated).toEqual(expect.objectContaining({ id: "product_1", name: "Updated Atta", sync_status: "pending_sync" }));
    expect(mockState.committed.products[0]).toEqual(expect.objectContaining({ id: "product_1", name: "Updated Atta" }));
    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "product_edited", entity_id: "product_1" }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "UPDATE_PRODUCT", entity_id: "product_1" }),
    ]));
  });

  it("soft deletes product only and keeps history tables untouched", async () => {
    const deleted = await deleteProductLocalFirst("product_1", "1234", "Duplicate product");

    expect(deleted).toEqual(expect.objectContaining({ id: "product_1", deletedAt: expect.any(String) }));
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockState.lastTables).toEqual(["products", "local_audit_logs", "sync_outbox"]);
    expect(mockState.committed.products[0]).toEqual(expect.objectContaining({
      id: "product_1",
      deletedAt: expect.any(String),
      deleted_at: expect.any(String),
      sync_status: "pending_sync",
    }));
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("products", "product_1");
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("inventory", "product_1");
  });

  it("blocks product delete before local writes when owner PIN is missing", async () => {
    await expect(deleteProductLocalFirst("product_1", "", "Duplicate product")).rejects.toThrow(/Owner PIN/i);

    expect(mockedOfflineDB.getAll).not.toHaveBeenCalled();
    expect(mockedOfflineDB.transaction).not.toHaveBeenCalled();
    expect(mockState.committed.products).toHaveLength(0);
    expect(mockState.committed.local_audit_logs).toHaveLength(0);
    expect(mockState.committed.sync_outbox).toHaveLength(0);
  });

  it("creates audit log and outbox operation for product delete", async () => {
    await deleteProductLocalFirst("product_1", "1234", "Duplicate product");

    expect(mockState.committed.local_audit_logs).toEqual(expect.arrayContaining([
      expect.objectContaining({
        action: "product_deleted",
        entity_type: "product",
        entity_id: "product_1",
        reason: "Duplicate product",
        owner_pin_provided: true,
      }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "DELETE_PRODUCT_PENDING",
        entity_type: "product",
        entity_id: "product_1",
        payload: expect.objectContaining({
          productId: "product_1",
          ownerPin: "1234",
          reason: "Duplicate product",
          ownerPinProvided: true,
        }),
      }),
    ]));
  });

  it("rolls back product write when audit or outbox insert fails", async () => {
    mockState.failOnStore = "local_audit_logs";

    await expect(createProductLocalFirst(baseProductInput)).rejects.toThrow(/forced local_audit_logs failure/i);

    expect(mockState.committed.products).toHaveLength(0);
    expect(mockState.committed.local_audit_logs).toHaveLength(0);
    expect(mockState.committed.sync_outbox).toHaveLength(0);
    expect(mockedUpsertCachedListItem).not.toHaveBeenCalled();
  });
});
