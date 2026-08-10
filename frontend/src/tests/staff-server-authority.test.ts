import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as Array<Record<string, unknown>>,
  networkDown: false,
  cacheFails: false,
  invites: [] as Array<{ data: Record<string, unknown>; ownerPin: string }>,
}));

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "tenant_staff", store_id: "store_staff", device_id: "device_staff" }),
  nowIso: () => "2026-08-10T18:00:00.000Z",
}));

vi.mock("@/lib/offline/instant-cache", () => ({ emitLocalDataChanged: vi.fn() }));

vi.mock("@/lib/api/http", () => ({
  isRecoverableNetworkError: (error: unknown) => error instanceof Error && error.message === "network unavailable",
}));

vi.mock("@/features/core/staff/api", () => ({
  listStaff: vi.fn(async () => []),
  inviteStaff: vi.fn(async (data: Record<string, unknown>, ownerPin: string) => {
    state.invites.push({ data, ownerPin });
    if (state.networkDown) throw new Error("network unavailable");
    return {
      id: "staff_server_1",
      name: data.name,
      mobile: data.mobile,
      email: data.email,
      role: data.role,
      createdAt: "2026-08-10T18:00:00.000Z",
      updatedAt: "2026-08-10T18:00:00.000Z",
    };
  }),
  updateStaff: vi.fn(),
  removeStaff: vi.fn(),
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: vi.fn(async () => undefined),
    staff_users: {
      get: vi.fn(async (id: string) => state.rows.find((row) => row.id === id)),
      put: vi.fn(async (row: Record<string, unknown>) => {
        if (state.cacheFails) throw new Error("cache unavailable");
        const index = state.rows.findIndex((existing) => existing.id === row.id);
        if (index >= 0) state.rows[index] = structuredClone(row);
        else state.rows.push(structuredClone(row));
      }),
    },
  },
  offlineDB: { getAll: vi.fn(async () => structuredClone(state.rows)) },
}));

import { createStaffLocalFirst } from "@/features/core/staff/local-actions";

const input = {
  name: "Counter One",
  mobile: "9876543210",
  password: "Secure123",
  role: "cashier" as const,
  ownerPin: "1234",
  ownerPinReason: "Add counter cashier",
};

describe("staff server authority", () => {
  beforeEach(() => {
    state.rows = [];
    state.networkDown = false;
    state.cacheFails = false;
    state.invites = [];
  });

  it("shows a staff account locally only after the server confirms it", async () => {
    const member = await createStaffLocalFirst(input);

    expect(state.invites).toEqual([{ data: expect.objectContaining({ role: "staff", password: "Secure123" }), ownerPin: "1234" }]);
    expect(member).toEqual(expect.objectContaining({ id: "staff_server_1", role: "cashier", sync_status: "synced" }));
    expect(state.rows).toEqual([expect.objectContaining({ id: "staff_server_1", server_id: "staff_server_1", sync_status: "synced" })]);
  });

  it("never enables an unverified local staff row while offline", async () => {
    state.networkDown = true;

    await expect(createStaffLocalFirst(input)).rejects.toThrow(/Reconnect.*no unverified staff access was enabled locally/i);
    expect(state.rows).toHaveLength(0);
  });

  it("does not report a server-confirmed account as failed only because the read cache is unavailable", async () => {
    state.cacheFails = true;

    await expect(createStaffLocalFirst(input)).resolves.toEqual(
      expect.objectContaining({ id: "staff_server_1", role: "cashier", sync_status: "synced" }),
    );
    expect(state.rows).toHaveLength(0);
  });
});
