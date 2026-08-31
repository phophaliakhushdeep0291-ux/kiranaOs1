import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync("src/features/core/expenses/local-actions.ts", "utf8");
const page = readFileSync("src/features/core/expenses/pages/ExpensesPage.tsx", "utf8");
const db = readFileSync("src/lib/offline/db.ts", "utf8");
const pull = readFileSync("src/features/core/sync/sync-pull.ts", "utf8");
const expenseRoutes = readFileSync("../backend/src/modules/expenses/expenses.routes.js", "utf8");
const syncService = readFileSync("../backend/src/modules/sync/sync.service.js", "utf8");

describe("offline expense contract", () => {
  it("commits the expense and stable outbox event atomically", () => {
    expect(db).toContain('expenses!: Table<OfflineRow, string>');
    expect(actions).toContain('offlineDB.transaction(["expenses", "sync_outbox"]');
    expect(actions).toContain('operation_type: "CREATE_EXPENSE"');
    expect(actions).toContain('idempotency_key: idempotencyKey');
    expect(actions).toContain('operation_type: "UPDATE_EXPENSE"');
    expect(actions).toContain('operation_type: "DELETE_EXPENSE"');
    expect(actions).toContain('if (!/^\\d{4}$/.test(ownerPin))');
    expect(actions).toContain('changes: data,');
    expect(actions).toContain('ownerPin,');
  });

  it("renders local expenses immediately and pulls cross-device changes", () => {
    expect(page).toContain("createExpenseLocalFirst(vars.data)");
    expect(page).toContain('updateExpenseLocalFirst(vars.id, vars.data, vars.ownerPin ?? "")');
    expect(page).toContain("deleteExpenseLocalFirst(vars.id, vars.ownerPin)");
    expect(page).toContain('placeholder="4-digit PIN to approve this edit"');
    expect(page).toContain("mergeExpenseSnapshots");
    expect(pull).toContain('["expenses", "expense"]');
  });

  it("requires the same owner approval online and during offline replay", () => {
    expect(expenseRoutes).toContain('router.patch("/:id", requireOwnerPin, validate(updateExpenseSchema), ctrl.update)');
    const updateCase = syncService.slice(
      syncService.indexOf("case SYNC_EVENT_TYPES.UPDATE_EXPENSE:"),
      syncService.indexOf("case SYNC_EVENT_TYPES.DELETE_EXPENSE:"),
    );
    expect(updateCase).toContain("assertOwnerPermission(shopId, user, getEventOwnerPin(event))");
    expect(actions).toContain("updateExpenseLocalFirst(id: string, data: ExpenseInput, ownerPin: string)");
  });
});
