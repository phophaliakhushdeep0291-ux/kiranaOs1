import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  scope: { tenant_id: "shop-a", store_id: "shop-a", device_id: "device-a" },
  rows: [] as Record<string, unknown>[],
  failPut: false,
  list: vi.fn(),
  notify: vi.fn(),
}));

vi.mock("@/lib/offline/context", () => ({ getOfflineScope: () => ({ ...state.scope }) }));
vi.mock("@/features/core/sync/api", () => ({ listSyncConflicts: state.list }));
vi.mock("@/lib/offline/db", () => ({
  offlineDB: { getAll: async () => structuredClone(state.rows) },
  filterRowsForCurrentScope: (rows: Record<string, unknown>[]) => rows.filter((row) =>
    row.tenant_id === state.scope.tenant_id && row.store_id === state.scope.store_id,
  ),
  dexieDB: {
    transaction: async (_mode: string, _tables: unknown, callback: () => Promise<void>) => {
      const before = structuredClone(state.rows);
      try { await callback(); } catch (error) { state.rows = before; throw error; }
    },
    sync_conflicts: {
      put: async (row: Record<string, unknown>) => {
        if (state.failPut) throw new Error("Storage full");
        const index = state.rows.findIndex((old) => old.id === row.id);
        if (index < 0) state.rows.push(structuredClone(row));
        else state.rows[index] = structuredClone(row);
      },
    },
  },
}));

function server(id = "cloud-1", extra: Record<string, unknown> = {}) {
  return {
    id, client_conflict_id: null, source_event_id: "event-1", device_id: "device-b",
    entity_type: "product", entity_id: "product-1", status: "open", version: 2,
    local_snapshot: { price: 10 }, server_snapshot: { price: 12 }, message: "Prices differ",
    created_at: "2026-01-01T10:00:00.000Z", updated_at: "2026-01-01T10:00:00.000Z", ...extra,
  };
}

function local(extra: Record<string, unknown> = {}) {
  return {
    ...state.scope, id: "local-1", server_conflict_id: "cloud-1", source_event_id: "event-1",
    sync_status: "conflict", resolution: "unresolved", version: 1,
    created_at: "2026-01-01T10:00:00.000Z", updated_at: "2026-01-01T10:00:00.000Z", ...extra,
  };
}

function page(rows: ReturnType<typeof server>[], cursor: string | null = null) {
  return { conflicts: rows, pagination: { hasMore: Boolean(cursor), nextCursor: cursor, limit: 100 } };
}

beforeEach(() => {
  vi.resetModules();
  state.rows = [];
  state.scope = { tenant_id: "shop-a", store_id: "shop-a", device_id: "device-a" };
  state.failPut = false;
  state.list.mockReset();
  state.notify.mockReset();
  vi.stubGlobal("window", { dispatchEvent: state.notify });
});

describe("shared server conflict cache", () => {
  it("persists every page for the header and offline reports", async () => {
    state.list.mockResolvedValueOnce(page([server()], "page-2"))
      .mockResolvedValueOnce(page([server("cloud-2", { source_event_id: "event-2" })]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");

    await refreshServerConflictCache();

    expect(state.rows).toHaveLength(2);
    expect(state.rows[0]).toEqual(expect.objectContaining({ ...state.scope, device_id: "device-b", server_conflict_id: "cloud-1", resolution: "unresolved" }));
    expect(state.list).toHaveBeenLastCalledWith(expect.objectContaining({ cursor: "page-2" }));
    expect(state.notify).toHaveBeenCalledTimes(1);
  });

  it("reopens a cloud review hidden by an older automatic cleanup", async () => {
    state.rows = [local({ resolution: "auto_resolved", sync_status: "synced" })];
    state.list.mockResolvedValue(page([server()]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    expect(state.rows).toHaveLength(1);
    expect(state.rows[0].resolution).toBe("unresolved");
  });

  it("strips credentials before persisting cloud snapshots", async () => {
    state.list.mockResolvedValue(page([server("cloud-1", {
      local_snapshot: { price: 10, ownerPin: "123456", nested: { accessToken: "secret-value" } },
      server_snapshot: { price: 12, password: "private", ownerPinProvided: true },
    })]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    expect(state.rows[0].local_snapshot).toEqual({ price: 10, nested: {} });
    expect(state.rows[0].server_snapshot).toEqual({ price: 12, ownerPinProvided: true });
  });

  it("closes only known cloud reviews after a complete listing, retaining local-only reviews", async () => {
    state.rows = [local(), local({ id: "only-local", server_conflict_id: undefined, source_event_id: "pull-sequence" })];
    state.list.mockResolvedValue(page([]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    expect(state.rows[0].resolution).toBe("server_closed");
    expect(state.rows[1].resolution).toBe("unresolved");
  });

  it("does not close or publish anything when a later page fails", async () => {
    state.rows = [local()];
    state.list.mockResolvedValueOnce(page([server("another")], "page-2"))
      .mockRejectedValueOnce(new Error("Offline"));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await expect(refreshServerConflictCache()).rejects.toThrow("Offline");
    expect(state.rows).toEqual([local()]);
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("rejects repeated pagination cursors without changing the cache", async () => {
    state.rows = [local()];
    state.list.mockResolvedValue(page([], "same-cursor"));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await expect(refreshServerConflictCache()).rejects.toThrow("did not advance");
    expect(state.list).toHaveBeenCalledTimes(2);
    expect(state.rows).toEqual([local()]);
  });

  it("never writes an old shop's response into a newly selected shop", async () => {
    state.list.mockImplementation(async () => {
      state.scope = { tenant_id: "shop-b", store_id: "shop-b", device_id: "device-a" };
      return page([server()]);
    });
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    expect(state.rows).toHaveLength(0);
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("does not reopen an owner decision saved while the request was running", async () => {
    state.rows = [local()];
    state.list.mockImplementation(async () => {
      state.rows[0] = { ...state.rows[0], sync_status: "synced", resolution: "use_server" };
      return page([server()]);
    });
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    expect(state.rows[0].resolution).toBe("use_server");
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("rolls back failed persistence and does not publish success", async () => {
    state.list.mockResolvedValue(page([server()]));
    state.failPut = true;
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await expect(refreshServerConflictCache()).rejects.toThrow("Storage full");
    expect(state.rows).toHaveLength(0);
    expect(state.notify).not.toHaveBeenCalled();
  });

  it("coalesces forced in-flight reads and throttles background reads", async () => {
    state.list.mockResolvedValue(page([server()]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await Promise.all([refreshServerConflictCache(), refreshServerConflictCache({ force: true })]);
    await refreshServerConflictCache();
    expect(state.list).toHaveBeenCalledTimes(1);
  });

  it("does not repeatedly notify on an unchanged server response", async () => {
    state.list.mockResolvedValue(page([server()]));
    const { refreshServerConflictCache } = await import("@/features/core/sync/sync-conflict-cache");
    await refreshServerConflictCache();
    await refreshServerConflictCache({ force: true });
    expect(state.rows).toHaveLength(1);
    expect(state.notify).toHaveBeenCalledTimes(1);
  });
});
