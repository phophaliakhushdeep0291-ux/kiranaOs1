import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const actions = readFileSync("src/features/expenses/local-actions.ts", "utf8");
const page = readFileSync("src/features/expenses/pages/ExpensesPage.tsx", "utf8");
const db = readFileSync("src/lib/offline/db.ts", "utf8");
const pull = readFileSync("src/features/sync/sync-pull.ts", "utf8");

describe("offline expense contract", () => {
  it("commits the expense and stable outbox event atomically", () => {
    expect(db).toContain('expenses!: Table<OfflineRow, string>');
    expect(actions).toContain('offlineDB.transaction(["expenses", "sync_outbox"]');
    expect(actions).toContain('operation_type: "CREATE_EXPENSE"');
    expect(actions).toContain('idempotency_key: idempotencyKey');
  });

  it("renders local expenses immediately and pulls cross-device changes", () => {
    expect(page).toContain("createExpenseLocalFirst(vars.data)");
    expect(page).toContain("mergeExpenseSnapshots");
    expect(pull).toContain('["expenses", "expense"]');
  });
});
