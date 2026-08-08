import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const auth = readFileSync("src/features/core/auth/AuthContext.tsx", "utf8");
const http = readFileSync("src/lib/api/http.ts", "utf8");

describe("authentication route recovery", () => {
  it("stashes the exact protected URL before same-tab and cross-tab expiry redirects", () => {
    expect(auth).toContain("function stashCurrentProtectedLocation()");
    expect(auth).toContain("window.location.pathname + window.location.search + window.location.hash");
    expect(auth.match(/stashCurrentProtectedLocation\(\)/g)?.length).toBeGreaterThanOrEqual(3);
    expect(auth).toContain('setLocation("/login")');
  });

  it("bounds refresh latency independently of ordinary mutation requests", () => {
    const refreshStart = http.indexOf("async function refreshAuthSession");
    const refreshEnd = http.indexOf("function persistRefreshedAuth", refreshStart);
    const refreshSource = http.slice(refreshStart, refreshEnd);
    expect(refreshSource).toContain("timeoutMs: 8_000");
    expect(http).toContain('return isReadMethod(method) ? 15_000 : 30_000');
  });
});
