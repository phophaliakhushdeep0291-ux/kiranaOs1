import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: {} as Record<string, Array<Record<string, unknown>>>,
  nextId: 0,
  failBeforeCommit: false,
}));

function put(table: string, value: Record<string, unknown>, target = state.rows) {
  target[table] ??= [];
  const key = table === "sync_outbox" ? "clientEventId" : "id";
  const index = target[table].findIndex((row) => row[key] === value[key]);
  if (index >= 0) target[table][index] = structuredClone(value);
  else target[table].push(structuredClone(value));
}

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "tenant_staff", store_id: "store_staff", device_id: "device_staff" }),
  nowIso: () => "2026-08-10T18:00:00.000Z",
}));

vi.mock("@/lib/offline/instant-cache", () => ({
  createLocalId: vi.fn((prefix: string) => `${prefix}_${++state.nextId}`),
  emitLocalDataChanged: vi.fn(),
}));

vi.mock("@/lib/offline/db", () => ({
  dexieDB: {
    open: vi.fn(async () => undefined),
    staff_users: { get: vi.fn(async (id: string) => state.rows.staff_users?.find((row) => row.id === id)) },
  },
  offlineDB: {
    getAll: vi.fn(async (table: string) => structuredClone(state.rows[table] ?? [])),
    transaction: vi.fn(async (_tables: string[], callback: (tx: {
      put: (table: string, value: Record<string, unknown>) => Promise<void>;
      enqueueOutboxOperation: (event: Record<string, unknown>) => Promise<void>;
    }) => Promise<void>) => {
      const staged = structuredClone(state.rows);
      await callback({
        put: vi.fn(async (table, value) => put(table, value, staged)),
        enqueueOutboxOperation: vi.fn(async (event) => put("sync_outbox", event, staged)),
      });
      if (state.failBeforeCommit) throw new Error("simulated staff commit failure");
      state.rows = staged;
    }),
  },
}));

import { createStaffLocalFirst } from "@/features/core/staff/local-actions";

describe("offline staff atomicity", () => {
  beforeEach(() => {
    state.rows = { staff_users: [], local_audit_logs: [], sync_outbox: [] };
    state.nextId = 0;
    state.failBeforeCommit = false;
  });

  it("commits staff permissions, audit, and both sync intents together", async () => {
    const member = await createStaffLocalFirst({
      name: "Counter One",
      mobile: "9876543210",
      role: "cashier",
      ownerPin: "1234",
      ownerPinReason: "Add counter cashier",
    });

    expect(state.rows.staff_users).toEqual([expect.objectContaining({ id: member.id, role: "cashier" })]);
    expect(state.rows.local_audit_logs).toEqual([
      expect.objectContaining({ action: "staff_permission_change", entity_id: member.id, owner_pin_provided: true }),
    ]);
    expect(state.rows.sync_outbox.map((row) => row.operation_type).sort()).toEqual(["AUDIT_LOG_APPEND", "STAFF_ACTION"]);
    expect(state.rows.sync_outbox.find((row) => row.operation_type === "STAFF_ACTION")).toEqual(
      expect.objectContaining({ idempotency_key: `staff:create:${member.id}:2026-08-10T18:00:00.000Z` }),
    );
  });

  it("leaves no locally effective staff row when the transaction fails", async () => {
    state.failBeforeCommit = true;

    await expect(createStaffLocalFirst({
      name: "Counter Two",
      mobile: "9123456789",
      role: "cashier",
      ownerPin: "1234",
      ownerPinReason: "Add second cashier",
    })).rejects.toThrow("simulated staff commit failure");

    expect(state.rows.staff_users).toHaveLength(0);
    expect(state.rows.local_audit_logs).toHaveLength(0);
    expect(state.rows.sync_outbox).toHaveLength(0);
  });
});
