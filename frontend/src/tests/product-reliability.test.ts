import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product, ProductInput } from "@/types/api";

const mockState = vi.hoisted(() => ({
  idCounter: 0,
  products: [] as Array<Record<string, unknown>>,
  committed: {
    products: [] as Array<Record<string, unknown>>,
    local_audit_logs: [] as Array<Record<string, unknown>>,
    sync_outbox: [] as Array<Record<string, unknown>>,
  },
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
      mockState.committed.products.push(...pending.products);
      mockState.committed.local_audit_logs.push(...pending.local_audit_logs);
      mockState.committed.sync_outbox.push(...pending.sync_outbox);
      return result;
    }),
  },
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_reliability_${++mockState.idCounter}`),
  emitLocalDataChanged: vi.fn(),
  removeCachedListItem: vi.fn(),
  upsertCachedListItem: vi.fn(),
  readInstantCache: vi.fn(() => []),
}));

import { offlineDB } from "@/lib/offline/db";
import { emitLocalDataChanged, removeCachedListItem, upsertCachedListItem } from "@/lib/offline/instant-cache";
import { createProductLocalFirst, deleteProductLocalFirst, patchProductLocalFirst, updateProductLocalFirst } from "@/features/core/products/local-actions";
import { productUpdateNeedsOwnerApproval } from "@/features/core/products/pages/product-form-state";
import {
  findDuplicateProductWarnings,
  mergeProductAliasSuggestions,
  productMatchesSearch,
} from "@/features/core/products/product-reliability";

const mockedOfflineDB = vi.mocked(offlineDB);
const mockedEmitLocalDataChanged = vi.mocked(emitLocalDataChanged);
const mockedRemoveCachedListItem = vi.mocked(removeCachedListItem);
const mockedUpsertCachedListItem = vi.mocked(upsertCachedListItem);

const baseProductInput: ProductInput = {
  name: "Sugar",
  category: "grocery",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "gram",
  rateUnit: "kg",
  barcode: "8901000000011",
  aliases: ["chini", "cheeni", "चीनी"],
  stockBaseQty: 5000,
  defaultPricePerRateUnit: 45,
  sellingPrice: 45,
  retailPrice: 45,
  wholesalePrice: 43,
  minimumSellingPrice: 40,
  lowStockThreshold: 1000,
  isActive: true,
};

const existingProduct = {
  id: "product_sugar",
  local_id: "product_sugar",
  server_id: "server_product_sugar",
  name: "Sugar",
  category: "grocery",
  unit: "kg",
  displayUnit: "kg",
  baseUnit: "gram",
  rateUnit: "kg",
  barcode: "8901000000011",
  sku: "SUGAR-1KG",
  aliases: ["chini", "cheeni", "चीनी", "शक्कर"],
  stockBaseQty: 5000,
  defaultPricePerRateUnit: 45,
  sellingPrice: 45,
  retailPrice: 45,
  wholesalePrice: 43,
  minimumSellingPrice: 40,
  createdAt: "2026-06-06T09:00:00.000Z",
  updatedAt: "2026-06-06T09:00:00.000Z",
  sync_status: "synced",
} satisfies Product & Record<string, unknown>;

function resetCommitted() {
  mockState.committed.products = [];
  mockState.committed.local_audit_logs = [];
  mockState.committed.sync_outbox = [];
}

describe("product reliability", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockState.idCounter = 0;
    mockState.products = [{ ...existingProduct }];
    mockState.lastTables = [];
    resetCommitted();
  });

  it("product create works offline", async () => {
    const created = await createProductLocalFirst({ ...baseProductInput, name: "Loose Sugar", barcode: "8901000000028" });

    expect(created).toEqual(expect.objectContaining({
      id: "product_reliability_1",
      local_id: "product_reliability_1",
      name: "Loose Sugar",
      sync_status: "pending_sync",
    }));
    expect(mockedOfflineDB.transaction).toHaveBeenCalledTimes(1);
    expect(mockState.lastTables).toEqual(expect.arrayContaining(["products", "local_audit_logs", "sync_outbox"]));
    expect(mockState.committed.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, name: "Loose Sugar" }),
    ]));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "CREATE_PRODUCT", entity_type: "product", entity_id: created.id }),
    ]));
    expect(mockedUpsertCachedListItem).toHaveBeenCalledWith("products", expect.objectContaining({ id: created.id }), 1000);
    expect(mockedEmitLocalDataChanged).toHaveBeenCalledWith({ entityType: "product", action: "created", entityId: created.id });
  });

  it("product update works offline", async () => {
    const updated = await updateProductLocalFirst("product_sugar", {
      ...baseProductInput,
      name: "Premium Sugar",
      defaultPricePerRateUnit: 48,
      sellingPrice: 48,
    });

    expect(updated).toEqual(expect.objectContaining({
      id: "product_sugar",
      name: "Premium Sugar",
      defaultPricePerRateUnit: 48,
      sync_status: "pending_sync",
    }));
    expect(mockState.committed.products[0]).toEqual(expect.objectContaining({ id: "product_sugar", name: "Premium Sugar" }));
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "UPDATE_PRODUCT", entity_id: "product_sugar" }),
    ]));
    expect(mockedEmitLocalDataChanged).toHaveBeenCalledWith({ entityType: "product", action: "updated", entityId: "product_sugar" });
  });

  it("preserves approval supplied with a partial product update for cloud sync", async () => {
    await patchProductLocalFirst("product_sugar", {
      defaultPricePerRateUnit: 48,
      ownerPin: "1234",
      ownerPinReason: "New supplier price",
    });

    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({
        operation_type: "UPDATE_PRODUCT",
        entity_id: "product_sugar",
        payload: expect.objectContaining({
          ownerPin: "1234",
          reason: "New supplier price",
          ownerPinProvided: true,
        }),
      }),
    ]));
  });

  it("blocks a pack-tracking conversion until the product has zero stock", async () => {
    await expect(updateProductLocalFirst("product_sugar", {
      ...baseProductInput,
      packagingMode: "per_pack",
    })).rejects.toMatchObject({ code: "PACKAGING_MODE_STOCK_MIGRATION_REQUIRED" });

    expect(mockState.committed.sync_outbox).toHaveLength(0);
    expect(mockState.committed.products).toHaveLength(0);
  });

  it("allows normal edits to legacy per-pack products with stock", async () => {
    mockState.products = [{
      ...existingProduct,
      packagingMode: undefined,
      sellingUnits: [
        {
          name: "300 ml", unitType: "piece", unitCode: "piece-300-ml", conversionToBase: 1,
          defaultPrice: 124, onHandQty: 20, isDefault: true, isActive: true,
        },
        {
          name: "60 ml", unitType: "piece", unitCode: "piece-60-ml", conversionToBase: 1,
          defaultPrice: 38, onHandQty: 30, isDefault: false, isActive: true,
        },
      ],
    }];

    await expect(patchProductLocalFirst("product_sugar", { description: "Legacy pack product" })).resolves.toEqual(
      expect.objectContaining({
        packagingMode: "per_pack",
        description: "Legacy pack product",
        sellingUnits: expect.arrayContaining([
          expect.objectContaining({ unitCode: "piece-300-ml", onHandQty: 20 }),
          expect.objectContaining({ unitCode: "piece-60-ml", onHandQty: 30 }),
        ]),
      }),
    );
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "UPDATE_PRODUCT", entity_id: "product_sugar" }),
    ]));
  });

  it("keeps a 36-cell variant grid, per-pack stock, and pharmacy controls in the local record", async () => {
    const sellingUnits = Array.from({ length: 36 }, (_, index) => ({
      name: `Size ${index + 1}`,
      unitType: "piece",
      unitCode: `piece-size-${index + 1}`,
      conversionToBase: 1,
      defaultPrice: 100,
      onHandQty: 1,
      variantValue1: `S${Math.floor(index / 6) + 1}`,
      variantValue2: `C${(index % 6) + 1}`,
      isDefault: index === 0,
      isActive: true,
    }));
    const created = await createProductLocalFirst({
      ...baseProductInput,
      name: "Variant Medicine Grid",
      barcode: undefined,
      sku: undefined,
      packagingMode: "per_pack",
      stockBaseQty: 36,
      defaultPricePerRateUnit: 100,
      variantAxes: [
        { name: "Size", values: ["S1", "S2", "S3", "S4", "S5", "S6"] },
        { name: "Colour", values: ["C1", "C2", "C3", "C4", "C5", "C6"] },
      ],
      sellingUnits,
      batchTrackingEnabled: true,
      drugSchedule: "h",
      ownerPin: "1234",
    });

    expect(created.packagingMode).toBe("per_pack");
    expect(created.variantAxes).toHaveLength(2);
    expect(created.sellingUnits).toHaveLength(36);
    expect(created.sellingUnits?.[35]).toEqual(expect.objectContaining({ onHandQty: 1, variantValue1: "S6", variantValue2: "C6" }));
    expect(created.batchTrackingEnabled).toBe(true);
    expect(created.drugSchedule).toBe("h");
  });

  it("asks for owner approval by actual protected value changes, not full-payload field presence", () => {
    const current = {
      ...existingProduct,
      stockBaseQty: 5000,
      costPerRateUnit: 30,
      minPricePerRateUnit: 40,
      defaultPricePerRateUnit: 45,
      gstRate: 5,
      mrp: 50,
      packagingMode: "pooled" as const,
      batchTrackingEnabled: false,
      drugSchedule: null,
      isActive: true,
      sellingUnits: [],
      variantAxes: [],
    };
    const unchangedProtected: ProductInput = {
      ...baseProductInput,
      name: "Renamed Sugar",
      sku: "SUGAR-1KG",
      stockBaseQty: 5000,
      costPerRateUnit: 30,
      minPricePerRateUnit: 40,
      defaultPricePerRateUnit: 45,
      gstRate: 5,
      mrp: 50,
      packagingMode: "pooled",
      batchTrackingEnabled: false,
      drugSchedule: null,
      sellingUnits: [],
      variantAxes: [],
    };

    expect(productUpdateNeedsOwnerApproval(current, unchangedProtected)).toBe(false);
    expect(productUpdateNeedsOwnerApproval(current, { ...unchangedProtected, stockBaseQty: 5001 })).toBe(true);
    expect(productUpdateNeedsOwnerApproval(current, { ...unchangedProtected, defaultPricePerRateUnit: 46 })).toBe(true);
  });

  it("product delete is soft delete", async () => {
    const deleted = await deleteProductLocalFirst("product_sugar", "1234", "Duplicate item");

    expect(deleted).toEqual(expect.objectContaining({ id: "product_sugar", deletedAt: expect.any(String) }));
    expect(mockedOfflineDB.delete).not.toHaveBeenCalled();
    expect(mockState.committed.products[0]).toEqual(expect.objectContaining({
      id: "product_sugar",
      deletedAt: expect.any(String),
      deleted_at: expect.any(String),
      sync_status: "pending_sync",
    }));
    expect(mockedRemoveCachedListItem).toHaveBeenCalledWith("products", "product_sugar");
    expect(mockState.committed.sync_outbox).toEqual(expect.arrayContaining([
      expect.objectContaining({ operation_type: "DELETE_PRODUCT_PENDING", entity_id: "product_sugar" }),
    ]));
    expect(mockedEmitLocalDataChanged).toHaveBeenCalledWith({ entityType: "product", action: "deleted", entityId: "product_sugar" });
  });

  it("alias suggestions merge without duplicates", () => {
    expect(mergeProductAliasSuggestions(
      ["sugar", "Chini", "चीनी"],
      ["chini", "cheeni", "Sugar", "चीनी", "शक्कर"],
    )).toEqual(["sugar", "Chini", "चीनी", "cheeni", "शक्कर"]);
  });

  it("product search matches name", () => {
    expect(productMatchesSearch(existingProduct, "sug")).toBe(true);
  });

  it("product search matches alias", () => {
    expect(productMatchesSearch(existingProduct, "cheeni")).toBe(true);
  });

  it("product search matches Hindi name", () => {
    expect(productMatchesSearch(existingProduct, "चीनी")).toBe(true);
  });

  it("product search matches barcode", () => {
    expect(productMatchesSearch(existingProduct, "8901000000011")).toBe(true);
  });

  it("product search matches category", () => {
    expect(productMatchesSearch(existingProduct, "grocery")).toBe(true);
  });

  it("duplicate product warning appears for sugar/chini/cheeni-style duplicates", () => {
    const warnings = findDuplicateProductWarnings(
      { name: "Cheeni", category: "grocery", aliases: ["chini", "sakar"] },
      [existingProduct],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        productId: "product_sugar",
        reason: expect.stringMatching(/alias/),
        message: expect.stringMatching(/possible duplicate/i),
        matchedTerms: expect.arrayContaining(["cheeni"]),
      }),
    ]));
  });

  it("chini detects sugar as a possible duplicate", () => {
    const warnings = findDuplicateProductWarnings(
      { name: "Chini", category: "grocery", aliases: [] },
      [existingProduct],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "product_sugar", reason: expect.stringMatching(/alias/) }),
    ]));
  });

  it("cheeni detects chini as a possible duplicate", () => {
    const chiniProduct = {
      ...existingProduct,
      id: "product_chini",
      name: "Chini",
      aliases: ["sugar"],
      barcode: "8901000000022",
      sku: "CHINI-1KG",
    } satisfies Product & Record<string, unknown>;

    const warnings = findDuplicateProductWarnings(
      { name: "Cheeni", category: "grocery", aliases: [] },
      [chiniProduct],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "product_chini", reason: expect.stringMatching(/alias/) }),
    ]));
  });

  it("barcode duplicate detected after normalization", () => {
    const warnings = findDuplicateProductWarnings(
      { name: "New Sugar Pack", category: "grocery", barcode: "8901-0000 00011", aliases: [] },
      [existingProduct],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({
        productId: "product_sugar",
        reason: "barcode",
        matchedTerms: ["8901000000011"],
      }),
    ]));
  });

  it("alias duplicate detected", () => {
    const warnings = findDuplicateProductWarnings(
      { name: "Premium Sweetener", category: "grocery", aliases: ["Cheeni"] },
      [existingProduct],
    );

    expect(warnings).toEqual(expect.arrayContaining([
      expect.objectContaining({ productId: "product_sugar", reason: "alias" }),
    ]));
  });

  it("warning appears but save can continue with confirmation", async () => {
    const warnings = findDuplicateProductWarnings(
      { name: "Chini", category: "grocery", aliases: ["sugar", "sugar", "चीनी"] },
      [existingProduct],
    );

    expect(warnings.length).toBeGreaterThan(0);

    const created = await createProductLocalFirst({
      ...baseProductInput,
      name: "Chini",
      barcode: "8901000000099",
      aliases: ["sugar", "sugar", "चीनी"],
    });

    expect(created).toEqual(expect.objectContaining({ name: "Chini" }));
    expect(created.aliases).toEqual(["sugar", "चीनी"]);
    expect(mockState.committed.products).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: created.id, name: "Chini", aliases: ["sugar", "चीनी"] }),
    ]));
  });
});
