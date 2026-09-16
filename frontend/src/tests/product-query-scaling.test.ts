import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Product } from "@/types/api";
const state = vi.hoisted(() => ({ local: [] as Product[], cached: [] as Product[], online: true, list: vi.fn(), write: vi.fn() }));
vi.mock("@tanstack/react-query", () => ({ useQuery: (options: unknown) => options, useMutation: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ ApiClientError: class extends Error {}, isBrowserOnline: () => state.online, isRecoverableNetworkError: () => true }));
vi.mock("@/features/core/products/api", () => ({ listProducts: state.list }));
vi.mock("@/features/core/products/local-actions", () => ({}));
vi.mock("@/features/core/stores/location-context", () => ({ getActiveLocationId: () => null }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getAll: async () => state.local, putMany: async () => {} } }));
vi.mock("@/lib/offline/instant-cache", () => ({ KEEP_EVERY_ROW: Infinity, instantCacheUpdatedAt: () => 0, readInstantCache: () => state.cached, writeInstantCache: state.write }));
import { useListProducts } from "@/features/core/products/queries";
const product = (id: string, extra = {}) => ({ id, name: id, aliases: [], deletedAt: null, ...extra }) as Product;
const query = (params?: Record<string, string | number>) => useListProducts(params) as unknown as { queryFn: () => Promise<Product[]>; initialData: () => Product[] | undefined };
beforeEach(() => { vi.clearAllMocks(); state.local = []; state.cached = []; state.online = true; });

describe("catalogue query scaling", () => {
  it("loads search results with one request and keeps unrelated cached products", async () => {
    state.local = [product("rice"), product("salt")];
    state.list.mockResolvedValue([product("rice", { name: "Rice updated" })]);
    const rows = await query({ search: "rice" }).queryFn();
    expect(rows.map((row) => row.name)).toEqual(["Rice updated"]);
    expect(state.list).toHaveBeenCalledTimes(1);
    expect(state.write.mock.calls[0][1].map((row: Product) => row.name)).toEqual(["Rice updated", "salt"]);
  });

  it("keeps a full offline snapshot when a picker only displays 350 rows", async () => {
    const all = Array.from({ length: 1500 }, (_, i) => product(`p${i}`));
    state.list.mockResolvedValue(all);
    expect(await query({ limit: 350 }).queryFn()).toHaveLength(350);
    expect(state.write.mock.calls[0][1]).toHaveLength(1500);
    expect(state.write.mock.calls[0][1][1499].id).toBe("p1499");
  });

  it("retains pending edits beyond the display limit in the cached snapshot", async () => {
    state.local = [product("a"), product("z", { name: "Local edit", sync_status: "pending_sync" })];
    state.list.mockResolvedValue([product("a"), product("z")]);
    await query({ limit: 1 }).queryFn();
    expect(state.write.mock.calls[0][1].find((row: Product) => row.id === "z").name).toBe("Local edit");
  });

  it("preserves tombstones while patching a filtered catalogue", async () => {
    state.local = [product("rice", { deletedAt: "2026-09-16", sync_status: "pending_sync" }), product("salt")];
    state.list.mockResolvedValue([product("rice")]);
    expect(await query({ search: "rice" }).queryFn()).toEqual([]);
    expect(state.write.mock.calls[0][1].find((row: Product) => row.id === "rice").deletedAt).toBe("2026-09-16");
  });

  it("keeps authoritative removal on an unfiltered refresh", async () => {
    state.local = [product("removed", { sync_status: "synced" })];
    state.list.mockResolvedValue([]);
    expect(await query().queryFn()).toEqual([]);
    expect(state.write.mock.calls[0][1]).toEqual([]);
  });

  it("performs no network requests offline and still honors display limits", async () => {
    state.online = false;
    state.local = [product("rice"), product("salt")];
    expect(await query({ limit: 1 }).queryFn()).toHaveLength(1);
    expect(state.list).not.toHaveBeenCalled();
  });

  it("defers initial cache scanning until query initialization", () => {
    let reads = 0;
    state.cached = [product("rice", { get deletedAt() { reads += 1; return null; } })];
    // Use a getter directly: spreading a test fixture evaluates it immediately.
    Object.defineProperty(state.cached[0], "deletedAt", { get() { reads += 1; return null; } });
    reads = 0;
    const options = query();
    expect(reads).toBe(0);
    expect(options.initialData()).toHaveLength(1);
    expect(reads).toBeGreaterThan(0);
  });
});
