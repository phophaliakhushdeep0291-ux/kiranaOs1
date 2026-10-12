import { createProductLocalFirst } from "@/features/core/products/local-actions";
import { stageBillLines, type StagedBillLine } from "@/features/core/billing/assistant-staging";
import type { AgentExecutionResult } from "./agent-client";
import { createSupplierLocalFirst } from "@/features/core/suppliers/local-actions";
import { createExpenseLocalFirst } from "@/features/core/expenses/local-actions";
import { assistantExpenseInput, assistantSupplierInput } from "./operating-task-inputs";

export async function executeClientActions(result: AgentExecutionResult, ownerPin?: string, applyBillLines?: (lines: StagedBillLine[]) => number, isCurrent: () => boolean = () => true) {
  let staged = 0;
  let applied = 0;
  let incompleteBill = false;
  const products: string[] = [];
  const expenses: string[] = [];
  const suppliers: string[] = [];
  const problems: string[] = [];
  for (const action of result.clientActions ?? []) {
    if (!isCurrent()) throw new Error("Assistant session changed before applying the action");
    if (action.action === "add_bill_lines") {
      const lines = action.payload.lines ?? [];
      if (applyBillLines) {
        const count = applyBillLines(lines);
        applied += count;
        incompleteBill ||= count < lines.length;
      } else staged += await stageBillLines(lines);
      problems.push(...(action.payload.problems ?? []).map(problem => problem.candidates?.length ? `${problem.query} (${problem.candidates.join(", ")})` : problem.query));
    } else if (action.action === "create_product") {
      if (!ownerPin || !action.payload.product) throw new Error("Approved product details and owner PIN are required");
      const saved = await createProductLocalFirst({ ...action.payload.product, ownerPin }, { assistantActionId: `${result.planId}:${action.ref}` });
      products.push(saved.name);
    } else if (action.action === "create_supplier") {
      const saved = await createSupplierLocalFirst(assistantSupplierInput.parse(action.payload.supplier), { assistantActionId: `${result.planId}:${action.ref}` });
      suppliers.push(saved.name);
    } else if (action.action === "create_expense") {
      const saved = await createExpenseLocalFirst(assistantExpenseInput.parse(action.payload.expense), { assistantActionId: `${result.planId}:${action.ref}` });
      expenses.push(saved.title);
    } else {
      // Unknown delivered actions must never be displayed as completed.
      throw new Error("Unsupported assistant action");
    }
  }
  return { staged, applied, incompleteBill, products, suppliers, expenses, problems };
}
