import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ProductInput } from "@/types/api";
import type { AgentExecutionResult } from "@/features/core/assistant/agent-client";
const memory = vi.hoisted(() => ({ rows: {} as Record<string, Record<string, unknown>[]>, settings: new Map<string, unknown>(), tail: Promise.resolve() as Promise<unknown>, fail: "", ids: 0 }));
vi.mock("@/lib/offline/db", () => ({ assertCurrentOfflineScope: vi.fn(), offlineDB: {
  getAll: async (table: string) => structuredClone(memory.rows[table] ?? []),
  getSetting: async (key: string) => structuredClone(memory.settings.get(key) ?? null),
  transaction: (tables: string[], work: (tx: { put: (table: string, value: unknown) => Promise<void>; enqueueOutboxOperation: (event: unknown) => Promise<void>; setSetting: (key: string, value: unknown) => Promise<void> }) => Promise<unknown>) => {
    const running = memory.tail.then(async () => {
      const before = structuredClone(memory.rows); const settings = structuredClone(memory.settings);
      const put = async (table: string, value: unknown) => {
        expect(tables).toContain(table);
        if (memory.fail === table) throw Error("Injected write failure");
        (memory.rows[table] ??= []).push(structuredClone(value) as Record<string, unknown>);
      };
      try { return await work({ put, enqueueOutboxOperation: event => put("sync_outbox", event), setSetting: async (key, value) => {
        expect(tables).toContain("settings"); if (memory.fail === "settings") throw Error("Injected write failure"); memory.settings.set(key, structuredClone(value));
      } }); } catch (error) { memory.rows = before; memory.settings = settings; throw error; }
    });
    memory.tail = running.catch(() => undefined); return running;
  },
} }));
vi.mock("@/lib/offline/instant-cache", () => ({ createLocalId: (prefix: string) => `${prefix}_${++memory.ids}`, emitLocalDataChanged: vi.fn(), upsertCachedListItem: vi.fn(), readInstantCache: () => [], removeCachedListItem: vi.fn(), writeInstantCache: vi.fn() }));
import { offlineDB, assertCurrentOfflineScope } from "@/lib/offline/db";
import { withTargetedReads } from "./support/targeted-offline-reads";
import { createProductLocalFirst } from "@/features/core/products/local-actions";
import { executeClientActions } from "@/features/core/assistant/execute-client-actions";
import { planDecision } from "@/features/core/assistant/task-commands";
withTargetedReads(offlineDB);
const product: ProductInput = { name: "Rice", displayUnit: "kg", rateUnit: "kg", baseUnit: "gram", defaultPricePerRateUnit: 64.5, costPerRateUnit: 50, stockBaseQty: 2500, gstRate: 5 };
const result: AgentExecutionResult = { planId: "plan-1", allSucceeded: true, executionStatus: "executed", requiresReview: false, results: [], clientActions: [{ ref: "1", action: "create_product", payload: { product } }] };
beforeEach(() => { vi.mocked(assertCurrentOfflineScope).mockReset(); memory.rows = {}; memory.settings = new Map(); memory.tail = Promise.resolve(); memory.fail = ""; });

describe("assistant product execution", () => {
  it("saves a reviewed product with audit and sync operation, keeping price and stock units", async () => {
    const applied = await executeClientActions(result, "1234");
    expect(applied.products).toEqual(["Rice"]);
    expect(memory.rows.products).toHaveLength(1);
    expect(memory.rows.products[0]).toMatchObject({ baseUnit: "gram", rateUnit: "kg", stockBaseQty: 2500, defaultPricePerRateUnit: 64.5, sync_status: "pending_sync" });
    expect(memory.rows.local_audit_logs).toHaveLength(1);
    expect(memory.rows.sync_outbox.filter(row => row.operation_type === "CREATE_PRODUCT")).toHaveLength(1);
    expect(JSON.stringify([...memory.settings.values()])).not.toContain("1234");
  });
  it("applies bill lines directly when the assistant is opened inside billing", async () => {
    const lines = [{ productId: "rice", name: "Rice", quantity: 2, unit: "kg", rate: 64.5 }];
    const apply = vi.fn(() => 1);
    const answer = await executeClientActions({ ...result, clientActions: [{ ref: "1", action: "add_bill_lines", payload: { lines } }] }, undefined, apply);
    expect(apply).toHaveBeenCalledWith(lines);
    expect(answer).toMatchObject({ staged: 0, applied: 1, incompleteBill: false });
    expect(memory.settings.size).toBe(0);
    apply.mockReturnValue(0);
    expect((await executeClientActions({ ...result, clientActions: [{ ref: "1", action: "add_bill_lines", payload: { lines } }] }, undefined, apply)).incompleteBill).toBe(true);
  });
  it("does not save into a different shop when the session changes during delivery", async () => {
    vi.mocked(assertCurrentOfflineScope).mockImplementationOnce(() => {}).mockImplementationOnce(() => { throw Error("Session changed"); });
    await expect(executeClientActions(result, "1234")).rejects.toThrow("Session changed");
    expect(memory.rows).toEqual({});
  });
  it("does not execute a product without the PIN used to approve it", async () => {
    await expect(executeClientActions(result)).rejects.toThrow(/PIN/);
    expect(memory.rows.products).toBeUndefined();
  });
  it("replays a lost local acknowledgement without another product or outbox write", async () => {
    await executeClientActions(result, "1234"); await executeClientActions(result, "1234");
    expect(memory.rows.products).toHaveLength(1);
    expect(memory.rows.sync_outbox.filter(row => row.operation_type === "CREATE_PRODUCT")).toHaveLength(1);
  });
  it("serializes concurrent delivery of the same confirmed action", async () => {
    const results = await Promise.all([createProductLocalFirst(product, { assistantActionId: "race" }), createProductLocalFirst(product, { assistantActionId: "race" })]);
    expect(results[0].id).toBe(results[1].id);
    expect(memory.rows.products).toHaveLength(1);
  });
  it.each(["products", "local_audit_logs", "sync_outbox", "settings"])("rolls back both receipt and product when %s fails", async table => {
    memory.fail = table;
    await expect(executeClientActions(result, "1234")).rejects.toThrow("Injected write failure");
    expect(memory.rows).toEqual({}); expect(memory.settings.size).toBe(0);
    memory.fail = ""; await executeClientActions(result, "1234");
    expect(memory.rows.products).toHaveLength(1);
  });
  it("refuses an existing local name and unknown delivered actions", async () => {
    memory.rows.products = [{ id: "existing", name: "Rice" }];
    await expect(executeClientActions(result, "1234")).rejects.toThrow(/already exists/);
    await expect(executeClientActions({ ...result, clientActions: [{ ref: "2", action: "unexpected", payload: {} }] })).rejects.toThrow(/Unsupported/);
  });
});

describe("explicit spoken decisions", () => {
  it.each(["yes", "Confirm!", "go ahead", "haan kar do", "हाँ कर दो।"])("accepts %s", text => expect(planDecision(text)).toBe("confirm"));
  it.each(["cancel", "no", "mat karo", "नहीं"])("cancels %s", text => expect(planDecision(text)).toBe("cancel"));
  it.each(["yes but change price to 50", "don't confirm", "can you confirm the price?", "confirm and delete everything", "1234", "हाँ लेकिन रेट ५०"])("does not approve an ambiguous or compound answer: %s", text => expect(planDecision(text)).toBeNull());
});
