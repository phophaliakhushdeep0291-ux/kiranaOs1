import { beforeEach, describe, expect, it, vi } from "vitest";

// The factory must not close over anything declared in this file. A static
// import of the module under test runs before the file body, so a hoisted const
// referenced from here is still in its temporal dead zone when the factory is
// called, and the whole file fails to collect. Build the spy inside the factory
// and read it back through the mocked module, as the sibling client tests do.
vi.mock("@/lib/api/http", () => ({ apiRequest: vi.fn() }));

import { apiRequest } from "@/lib/api/http";
import { submitAiFeedback } from "@/lib/ai/ai-feedback-client";

describe("AI quality feedback client", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());

  it.each([
    ["correct", "NONE"],
    ["misunderstood", "MISUNDERSTOOD_REQUEST"],
    ["unsafe", "UNSAFE_ACTION"],
  ] as const)("sends bounded %s feedback without transcript or free text", async (outcome, reasonCode) => {
    vi.mocked(apiRequest).mockResolvedValue({ actionLogId: "turn-1", outcome, recorded: true, duplicate: false });
    await submitAiFeedback("turn-1", outcome);
    expect(apiRequest).toHaveBeenCalledWith("/ai/feedback", {
      method: "POST",
      body: JSON.stringify({ actionLogId: "turn-1", outcome, reasonCode }),
    });
    const body = JSON.parse(String(vi.mocked(apiRequest).mock.calls[0][1]?.body));
    expect(body).not.toHaveProperty("transcript");
    expect(body).not.toHaveProperty("message");
    expect(body).not.toHaveProperty("customer");
  });
});
