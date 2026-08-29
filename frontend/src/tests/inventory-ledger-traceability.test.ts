import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  keepInventoryLedgerRowsWithActiveProducts,
  normalizeInventoryLedgerEntry,
  reconcileInventoryLedgerEntries,
} from "@/features/core/inventory/queries";

describe("inventory ledger traceability", () => {
  it("normalizes the server ledger contract without losing quantity or balances", () => {
    const entry = normalizeInventoryLedgerEntry({
      id: "ledger_1",
      productName: "Rice",
      action: "purchase",
      changeBaseQty: 12,
      oldStockBaseQty: 8,
      newStockBaseQty: 20,
      actorUserId: "owner_1",
      actorName: "Asha Owner",
      sourceType: "purchase_order_receipt",
      sourceId: "receipt_1",
      unit: "kg",
      createdAt: "2026-08-24T10:00:00.000Z",
    });

    expect(entry).toEqual(expect.objectContaining({
      quantityDelta: 12,
      stockBefore: 8,
      stockAfter: 20,
      actorUserId: "owner_1",
      actorName: "Asha Owner",
      sourceType: "purchase_order_receipt",
      sourceId: "receipt_1",
      unit: "kg",
    }));
  });

  it("keeps local snake-case movements traceable while pending sync", () => {
    const entry = normalizeInventoryLedgerEntry({
      id: "local_1",
      product_name: "Sugar",
      quantity_delta: -2,
      stock_before: 10,
      stock_after: 8,
      actor_user_id: "staff_1",
      actor_name: "Ravi Cashier",
      source_type: "manual_damage",
      source_id: "local_1",
      sync_status: "pending_sync",
      created_at: "2026-08-24T11:00:00.000Z",
    });

    expect(entry).toEqual(expect.objectContaining({
      productName: "Sugar",
      quantityDelta: -2,
      stockBefore: 10,
      stockAfter: 8,
      actorName: "Ravi Cashier",
      sourceType: "manual_damage",
      sync_status: "pending_sync",
    }));
  });

  it("drops stale synced cache rows after an authoritative server response", () => {
    const entries = reconcileInventoryLedgerEntries([
      {
        id: "old_shop_movement",
        product_name: "Coffee",
        action: "sale",
        sync_status: "synced",
        created_at: "2026-08-24T12:00:00.000Z",
      },
    ], [], 50);

    expect(entries).toEqual([]);
  });

  it("does not paint cached movements whose product is outside the active shop", () => {
    const rows = keepInventoryLedgerRowsWithActiveProducts([
      { id: "foreign", product_id: "kirana_product", sync_status: "synced" },
      { id: "current", productId: "restaurant_product", sync_status: "pending_sync" },
      { id: "unlinked", sync_status: "pending_sync" },
    ], new Set(["restaurant_product"]));

    expect(rows).toEqual([
      expect.objectContaining({ id: "current", productId: "restaurant_product" }),
    ]);
  });

  it("preserves only unsent local work and replaces its optimistic id with the server row", () => {
    const entries = reconcileInventoryLedgerEntries([
      {
        id: "local_movement_1",
        product_id: "product_rice",
        product_name: "Rice",
        action: "purchase",
        sync_status: "pending_sync",
        created_at: "2026-08-24T12:00:00.000Z",
      },
      {
        id: "stale_synced_movement",
        product_id: "product_old",
        product_name: "Old item",
        sync_status: "synced",
        created_at: "2026-08-24T11:00:00.000Z",
      },
    ], [
      {
        id: "server_movement_1",
        clientMovementId: "local_movement_1",
        product: { name: "Rice", baseUnit: "kg" },
        action: "purchase",
        createdAt: "2026-08-24T12:00:01.000Z",
      },
    ], 50);

    expect(entries).toHaveLength(1);
    expect(entries[0]).toEqual(expect.objectContaining({
      id: "server_movement_1",
      productName: "Rice",
      unit: "kg",
      sync_status: "synced",
    }));
  });

  it("renders phone-native trace cards in both stock-history surfaces", () => {
    const page = readFileSync("src/features/core/inventory/pages/InventoryPage.tsx", "utf8");
    const register = readFileSync("src/features/core/inventory/pages/components/InventoryRegisterView.tsx", "utf8");

    expect(page).toContain("MovementTraceCard");
    expect(page).toContain('md:hidden');
    expect(page).toContain('inventory.page.balance');
    expect(page).toContain('inventory.page.actor');
    expect(register).toContain('md:hidden');
    expect(register).toContain('sourceName(row)');
    expect(register).toContain('actorName(row)');
    expect(register).toContain('h-11 gap-2');
  });
});
