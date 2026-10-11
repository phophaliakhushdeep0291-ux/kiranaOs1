import { createProductLocalFirst } from "@/features/core/products/local-actions";
import { stageBillLines, type StagedBillLine } from "@/features/core/billing/assistant-staging";
import type { AgentExecutionResult } from "./agent-client";

export async function executeClientActions(result: AgentExecutionResult, ownerPin?: string, applyBillLines?: (lines: StagedBillLine[]) => number) {
  let staged = 0;
  let applied = 0;
  let incompleteBill = false;
  const products: string[] = [];
  const problems: string[] = [];
  for (const action of result.clientActions ?? []) {
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
    } else {
      // Unknown delivered actions must never be displayed as completed.
      throw new Error("Unsupported assistant action");
    }
  }
  return { staged, applied, incompleteBill, products, problems };
}
