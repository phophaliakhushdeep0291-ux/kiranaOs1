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
import { createExpenseLocalFirst } from "@/features/core/expenses/local-actions";
import { createSupplierLocalFirst } from "@/features/core/suppliers/local-actions";
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
  it("rejects delivery after a login or role change before any local write", async () => {
    await expect(executeClientActions(result, "1234", undefined, () => false)).rejects.toThrow(/session changed/);
    expect(memory.rows).toEqual({});
  });
  it("rechecks the session between client actions", async () => {
    const isCurrent = vi.fn().mockReturnValueOnce(true).mockReturnValue(false);
    const apply = vi.fn(() => 1);
    const bill = { ref: "2", action: "add_bill_lines", payload: { lines: [{ productId: "rice", name: "Rice", quantity: 1, unit: "kg", rate: 64.5 }] } };
    await expect(executeClientActions({ ...result, clientActions: [...result.clientActions!, bill] }, "1234", apply, isCurrent)).rejects.toThrow(/session changed/);
    expect(memory.rows.products).toHaveLength(1);
    expect(apply).not.toHaveBeenCalled();
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

describe("assistant expense and supplier delivery", () => {
  const supplier = { name: "North Foods", mobile: "9876543210", address: "Market road" };
  const expense = { title: "Electricity October", amount: 125.75, category: "utilities", paymentMode: "cash", status: "paid", recurringInterval: "none", spentAt: "2026-10-11T18:30:00.000Z" };
  const supplierResult: AgentExecutionResult = { ...result, clientActions: [{ ref: "supplier-1", action: "create_supplier", payload: { supplier } }] };
  const expenseResult: AgentExecutionResult = { ...result, clientActions: [{ ref: "expense-1", action: "create_expense", payload: { expense } }] };

  it("saves both reviewed records and queues their existing sync operations", async () => {
    const applied = await executeClientActions({ ...result, clientActions: [...supplierResult.clientActions!, ...expenseResult.clientActions!] });
    expect(applied.suppliers).toEqual(["North Foods"]); expect(applied.expenses).toEqual(["Electricity October"]);
    expect(memory.rows.suppliers[0]).toMatchObject({ ...supplier, sync_status: "pending_sync" });
    expect(memory.rows.expenses[0]).toMatchObject({ ...expense, sync_status: "pending_sync" });
    expect(memory.rows.sync_outbox.filter(row => row.operation_type === "CREATE_SUPPLIER")).toHaveLength(1);
    expect(memory.rows.sync_outbox.filter(row => row.operation_type === "CREATE_EXPENSE")).toHaveLength(1);
    expect(memory.rows.local_audit_logs).toHaveLength(1);
  });
  it.each([supplierResult, expenseResult])("replays a confirmed delivery only once", async delivery => {
    await Promise.all([executeClientActions(delivery), executeClientActions(delivery)]);
    await executeClientActions(delivery);
    const supplierDelivery = delivery === supplierResult;
    expect(memory.rows[supplierDelivery ? "suppliers" : "expenses"]).toHaveLength(1);
    expect(memory.rows.sync_outbox.filter(row => row.operation_type === (supplierDelivery ? "CREATE_SUPPLIER" : "CREATE_EXPENSE"))).toHaveLength(1);
    expect(memory.settings.size).toBe(1);
  });
  it.each(["suppliers", "local_audit_logs", "sync_outbox", "settings"])("rolls supplier creation back when %s fails", async table => {
    memory.fail = table; await expect(executeClientActions(supplierResult)).rejects.toThrow("Injected write failure");
    expect(memory.rows).toEqual({}); expect(memory.settings.size).toBe(0);
    memory.fail = ""; await executeClientActions(supplierResult); expect(memory.rows.suppliers).toHaveLength(1);
  });
  it.each(["expenses", "sync_outbox", "settings"])("rolls expense creation back when %s fails", async table => {
    memory.fail = table; await expect(executeClientActions(expenseResult)).rejects.toThrow("Injected write failure");
    expect(memory.rows).toEqual({}); expect(memory.settings.size).toBe(0);
    memory.fail = ""; await executeClientActions(expenseResult); expect(memory.rows.expenses).toHaveLength(1);
  });
  it.each([{ name: " NORTH  FOODS " }, { name: "Other", mobile: "9876543210" }])("refuses an existing supplier by name or phone", async existing => {
    memory.rows.suppliers = [{ id: "old", ...existing }];
    await expect(executeClientActions(supplierResult)).rejects.toThrow(/already exists/);
    expect(memory.rows.suppliers).toHaveLength(1); expect(memory.rows.sync_outbox).toBeUndefined();
  });
  it("ignores deleted suppliers when checking duplicates", async () => {
    memory.rows.suppliers = [{ id: "old", ...supplier, deleted_at: "2026-10-01" }];
    await executeClientActions(supplierResult); expect(memory.rows.suppliers).toHaveLength(2);
  });
  it.each([{ amount: -2 }, { amount: 1.001 }, { amount: NaN }, { spentAt: "tomorrow" }, { locationId: "other-branch" }, { status: "complete" }])("rejects malformed expense delivery before saving: %j", async bad => {
    await expect(executeClientActions({ ...result, clientActions: [{ ref: "bad", action: "create_expense", payload: { expense: { ...expense, ...bad } } }] })).rejects.toThrow();
    expect(memory.rows).toEqual({});
  });
  it("rejects unsupported phone formats without silently changing them", async () => {
    await expect(executeClientActions({ ...result, clientActions: [{ ref: "bad", action: "create_supplier", payload: { supplier: { ...supplier, mobile: "+971123456789" } } }] })).rejects.toThrow();
    expect(memory.rows).toEqual({});
  });
  it("keeps normal form saves independent of assistant receipts", async () => {
    await createSupplierLocalFirst(supplier); await createExpenseLocalFirst(expense);
    expect(memory.settings.size).toBe(0);
    expect(memory.rows.suppliers).toHaveLength(1); expect(memory.rows.expenses).toHaveLength(1);
  });
  it("refuses a late delivery after the branch or user changes", async () => {
    await expect(executeClientActions(expenseResult, undefined, undefined, () => false)).rejects.toThrow(/session changed/);
    expect(memory.rows).toEqual({});
  });
});
