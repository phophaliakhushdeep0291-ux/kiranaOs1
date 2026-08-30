import { describe, expect, it } from "vitest";
import { ApiClientError } from "@/lib/api/http";
import { agentErrorCode } from "@/features/core/assistant/agent-client";

/**
 * Where the failure code actually lives.
 *
 * This is a regression test for something that was live in production and
 * invisible: the assistant read `error.code`, but apiRequest throws an
 * ApiClientError that carries the server's code on `.data`. So every specific
 * failure — no AI provider configured, rate limited, owner PIN required —
 * collapsed into "That did not work. Try rephrasing it."
 *
 * The shop was being told to rephrase a perfectly good question while the real
 * answer, "AI is not configured on this server", was sitting one property away.
 */
describe("agentErrorCode", () => {
  it("reads the code from where ApiClientError actually puts it", () => {
    const error = new ApiClientError("AI is not configured", 503, { code: "AI_KEY_MISSING" });
    expect(agentErrorCode(error)).toBe("AI_KEY_MISSING");
  });

  it("distinguishes the failures the assistant reports differently", () => {
    expect(agentErrorCode(new ApiClientError("busy", 429, { code: "AI_RATE_LIMITED" }))).toBe("AI_RATE_LIMITED");
    expect(agentErrorCode(new ApiClientError("pin", 403, { code: "OWNER_PIN_REQUIRED" }))).toBe("OWNER_PIN_REQUIRED");
  });

  it("still reads a bare code, so a plain object from anywhere else works", () => {
    expect(agentErrorCode({ code: "AI_KEY_MISSING" })).toBe("AI_KEY_MISSING");
  });

  it("returns undefined rather than throwing on anything else", () => {
    expect(agentErrorCode(new Error("network"))).toBeUndefined();
    expect(agentErrorCode(null)).toBeUndefined();
    expect(agentErrorCode(undefined)).toBeUndefined();
    expect(agentErrorCode("string")).toBeUndefined();
  });
});
