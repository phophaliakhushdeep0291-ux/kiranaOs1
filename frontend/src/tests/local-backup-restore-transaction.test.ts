import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  tenantId: "shop_A",
  storeId: "shop_A",
  deviceId: "device_current",
  transactionCalls: 0,
}));

type Row = Record<string, unknown>;

function makeTable(name: string, keyPath: string, initialRows: Row[]) {
  let rows = structuredClone(initialRows);
  return {
    name,
    schema: { primKey: { keyPath } },
    toArray: vi.fn(async () => structuredClone(rows)),
    bulkDelete: vi.fn(async (keys: Array<string | number>) => {
      rows = rows.filter((row) => !keys.includes(row[keyPath] as string | number));
    }),
    bulkPut: vi.fn(async (incoming: Row[]) => {
      for (const row of incoming) {
        const key = row[keyPath];
        rows = rows.filter((candidate) => candidate[keyPath] !== key);
        rows.push(structuredClone(row));
      }
    }),
    replaceRows(nextRows: Row[]) {
      rows = structuredClone(nextRows);
    },
    rows() {
      return structuredClone(rows);
    },
  };
}

const tables = vi.hoisted(() => ({
  products: makeTable("products", "id", []),
  syncOutbox: makeTable("sync_outbox", "clientEventId", []),
  deviceLicense: makeTable("device_license_cache", "id", []),
  futureGlobal: makeTable("future_global", "id", []),
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: vi.fn(() => ({
    tenant_id: state.tenantId,
    store_id: state.storeId,
    device_id: state.deviceId,
  })),
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    verno: 6,
    tables: [tables.products, tables.syncOutbox, tables.deviceLicense, tables.futureGlobal],
    open: vi.fn(async () => undefined),
    transaction: vi.fn(async (_mode: string, _tables: unknown[], callback: () => Promise<void>) => {
      state.transactionCalls += 1;
      await callback();
    }),
  },
  isScopedTableName: vi.fn((name: string) => ["products", "sync_outbox", "device_license_cache"].includes(name)),
}));

import {
  createEncryptedLocalBackup,
  decryptLocalBackupEnvelope,
  encryptLocalBackupPayload,
  LOCAL_BACKUP_CONFIRMATION,
  LOCAL_BACKUP_FORMAT,
  previewEncryptedLocalBackup,
  restoreEncryptedLocalBackup,
  type LocalBackupPayload,
} from "@/features/core/recovery/local-backup";

const passphrase = "correct horse battery staple";

function row(id: string, tenant = "shop_A", store = "shop_A", extra: Row = {}): Row {
  return { id, tenant_id: tenant, store_id: store, ...extra };
}

describe("local backup export and atomic restore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    state.transactionCalls = 0;
    state.tenantId = "shop_A";
    state.storeId = "shop_A";
    state.deviceId = "device_current";
    tables.products.replaceRows([row("product_current"), row("product_other", "shop_B", "shop_B")]);
    tables.syncOutbox.replaceRows([]);
    tables.deviceLicense.replaceRows([row("license_secret", "shop_A", "shop_A", { payload: "must-not-export" })]);
    tables.futureGlobal.replaceRows([{ id: "global_setting", value: "must-not-touch" }]);
    vi.stubGlobal("window", { dispatchEvent: vi.fn() });
    vi.stubGlobal("CustomEvent", class CustomEventMock {
      constructor(public type: string, public init?: unknown) {}
    });
  });

  it("exports only the current shop and excludes device licences and unscoped tables", async () => {
    const backup = await createEncryptedLocalBackup(passphrase);
    const payload = await decryptLocalBackupEnvelope(await backup.blob.text(), passphrase);

    expect(payload.tables.products).toEqual([row("product_current")]);
    expect(payload.tables).not.toHaveProperty("device_license_cache");
    expect(payload.tables).not.toHaveProperty("future_global");
    expect(backup.rowCount).toBe(1);
  });

  it("requires reviewed replacement and restores only current-shop rows in one transaction", async () => {
    tables.syncOutbox.replaceRows([
      {
        clientEventId: "existing_A",
        tenant_id: "shop_A",
        store_id: "shop_A",
        device_id: "device_current",
        status: "PENDING",
        sync_status: "pending_sync",
      },
      {
        clientEventId: "existing_B",
        tenant_id: "shop_B",
        store_id: "shop_B",
        device_id: "device_B",
        status: "PENDING",
        sync_status: "pending_sync",
      },
    ]);
    const payload: LocalBackupPayload = {
      format: LOCAL_BACKUP_FORMAT,
      schemaVersion: 1,
      databaseVersion: 6,
      createdAt: "2026-08-08T12:00:00.000Z",
      scope: { tenant_id: "shop_A", store_id: "shop_A" },
      device: { device_id: "device_original", metadataOnly: true },
      tables: {
        products: [row("product_restored", "shop_A", "shop_A", { name: "Restored Rice" })],
        sync_outbox: [{
          clientEventId: "event_restored",
          tenant_id: "shop_A",
          store_id: "shop_A",
          device_id: "device_original",
          idempotency_key: "stable-idempotency-key",
          status: "SYNCING",
          sync_status: "syncing",
        }],
      },
    };
    const file = new Blob([await encryptLocalBackupPayload(payload, passphrase)]);
    const preview = await previewEncryptedLocalBackup(file, passphrase);
    expect(preview).toMatchObject({ requiresReplace: true, totalRows: 2, pendingSyncCount: 1 });

    await expect(restoreEncryptedLocalBackup(file, passphrase, {
      confirmation: LOCAL_BACKUP_CONFIRMATION,
      replaceExisting: false,
    })).rejects.toThrow(/already has local data/i);
    expect(state.transactionCalls).toBe(0);

    await restoreEncryptedLocalBackup(file, passphrase, {
      confirmation: LOCAL_BACKUP_CONFIRMATION,
      replaceExisting: true,
    });

    expect(state.transactionCalls).toBe(1);
    expect(tables.products.rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "product_restored", tenant_id: "shop_A" }),
      expect.objectContaining({ id: "product_other", tenant_id: "shop_B" }),
    ]));
    expect(tables.products.rows()).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "product_current" }),
    ]));
    expect(tables.syncOutbox.rows()).toEqual(expect.arrayContaining([
      expect.objectContaining({
        clientEventId: "event_restored",
        device_id: "device_current",
        restored_from_device_id: "device_original",
        idempotency_key: "stable-idempotency-key",
        status: "PENDING",
        sync_status: "pending_sync",
      }),
      expect.objectContaining({ clientEventId: "existing_B", tenant_id: "shop_B" }),
    ]));
    expect(tables.deviceLicense.rows()).toEqual([expect.objectContaining({ id: "license_secret" })]);
    expect(tables.futureGlobal.rows()).toEqual([{ id: "global_setting", value: "must-not-touch" }]);
  });
});
