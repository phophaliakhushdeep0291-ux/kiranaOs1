import { beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/api/http", async () => {
  const original = await vi.importActual<typeof import("@/lib/api/http")>("@/lib/api/http");
  return { ...original, apiRequest: vi.fn() };
});
import { apiRequest } from "@/lib/api/http";
import { sendAgentMessage, supersedeAgentPlan, getAgentCapabilities } from "@/features/core/assistant/agent-client";
beforeEach(() => { vi.mocked(apiRequest).mockReset(); });

it("loads capabilities from the signed-in shop without sending a client-selected trade or tenant", async () => {
  const signal = new AbortController().signal;
  vi.mocked(apiRequest).mockResolvedValue({ businessType: "restaurant", assistant: { title: { en: "Restaurant assistant", hi: "रेस्टोरेंट सहायक" }, examples: [] } });
  const result = await getAgentCapabilities(signal);
  expect(result.businessType).toBe("restaurant");
  expect(apiRequest).toHaveBeenCalledWith("/ai/agent/capabilities", { signal, timeoutMs: 10_000 });
});

it("acknowledges cancellation before accepting a replacement task", async () => {
  vi.mocked(apiRequest).mockResolvedValue({ planId: "old-plan", status: "rejected" });
  await expect(supersedeAgentPlan("old-plan")).resolves.toBeUndefined();
  expect(apiRequest).toHaveBeenCalledWith("/ai/agent/reject", { method: "POST", body: JSON.stringify({ planId: "old-plan" }) });
});
it.each(["executed", "executing", "uncertain", "failed"])("blocks a replacement when the previous plan is %s", async status => {
  vi.mocked(apiRequest).mockResolvedValue({ planId: "old-plan", status });
  await expect(supersedeAgentPlan("old-plan")).rejects.toMatchObject({ data: { code: "AI_PLAN_ALREADY_RESOLVED" } });
});
it("does not treat a lost cancellation response as successful", async () => {
  vi.mocked(apiRequest).mockRejectedValue(new Error("Network interrupted"));
  await expect(supersedeAgentPlan("old-plan")).rejects.toThrow("Network interrupted");
});
it("keeps proposal-rich follow-up history within the API's size limit", async () => {
  vi.mocked(apiRequest).mockResolvedValue({});
  await sendAgentMessage("Make it 70", Array.from({ length: 40 }, (_, index) => ({ role: "assistant", content: `${index}:` + "x".repeat(5000) })));
  const request = vi.mocked(apiRequest).mock.calls[0][1];
  const body = JSON.parse(request!.body as string);
  expect(body.history).toHaveLength(12);
  expect(body.history.every((message: { content: string }) => message.content.length <= 4000)).toBe(true);
  expect(body.history.at(-1).content.startsWith("39:")).toBe(true);
});
