import type { AgentExecutionResult, AgentExecutionStatus } from "./agent-client";

export interface ExecutionLabels {
  completed: string;
  prepared: string;
  failed: string;
  skipped: string;
  uncertain: string;
}
/** Only server receipts and canonical approval text; never model-generated success. */
export function executionFeedback(result: Pick<AgentExecutionResult, "results"> | AgentExecutionStatus, labels: ExecutionLabels): string {
  return result.results.map(row => {
    const status = row.outcomeUnknown ? labels.uncertain : row.skipped ? labels.skipped
      : !row.ok ? labels.failed : row.target === "client" ? labels.prepared : labels.completed;
    const receipt = "output" in row && typeof row.output?.receipt === "string" ? row.output.receipt : row.summary;
    return `${row.ref}. ${status}: ${receipt ?? ""}${row.error ? ` — ${row.error}` : ""}`;
  }).join("\n");
}
