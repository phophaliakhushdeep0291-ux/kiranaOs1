import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("offline backend banner", () => {
  it("keeps localhost diagnostics in development and shows cashier-safe copy in production", () => {
    expect(source).toContain("const showLocalhostDiagnostic = import.meta.env.DEV");
    expect(source).toContain("Cloud backup is paused because the backend is not reachable. Local billing still works.");
    expect(source).toContain("showLocalhostDiagnostic ?");
  });
});
