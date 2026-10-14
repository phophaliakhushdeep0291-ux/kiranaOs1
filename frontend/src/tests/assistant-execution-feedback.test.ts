import { describe, it, expect, vi } from "vitest";
vi.mock("@/lib/api/http", () => ({ apiRequest: vi.fn(), ApiClientError: class extends Error {} }));
import { apiRequest } from "@/lib/api/http";
import { getAgentPlanStatus } from "@/features/core/assistant/agent-client";
import { executionFeedback } from "@/features/core/assistant/execution-feedback";
const labels = { completed: "Completed", prepared: "Prepared", failed: "Failed", skipped: "Not started", uncertain: "Uncertain" };
describe("assistant execution evidence", () => {
  it("distinguishes receipts, device preparation, failures, skipped and uncertain steps", () => {
    const text = executionFeedback({ results: [
      { ref: "1", ok: true, target: "server", summary: "Receive goods", output: { receipt: "GRN-123; total 152; due 102" } },
      { ref: "2", ok: true, target: "client", summary: "Create rice" },
      { ref: "3", ok: false, summary: "Cancel PO", error: "Order changed" },
      { ref: "4", ok: false, skipped: true, summary: "Create customer" },
      { ref: "5", ok: false, outcomeUnknown: true, summary: "Record payment" },
    ] }, labels);
    expect(text).toBe("1. Completed: GRN-123; total 152; due 102\n2. Prepared: Create rice\n3. Failed: Cancel PO — Order changed\n4. Not started: Create customer\n5. Uncertain: Record payment");
  });
  it("retrieves status without confirming or replaying any action", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ planId: "plan-1", status: "executed", results: [] });
    await getAgentPlanStatus("plan-1");
    expect(apiRequest).toHaveBeenCalledExactlyOnceWith("/ai/agent/status", { method: "POST", body: '{"planId":"plan-1"}', timeoutMs: 10000 });
  });
});
