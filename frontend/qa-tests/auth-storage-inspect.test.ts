import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect auth storage contract", () => {
  it("prints the current persisted-session keys", () => {
    const source = readFileSync("src/features/core/auth/AuthContext.tsx", "utf8");
    console.log(source.split("\n").filter((line) => /localStorage|sessionStorage|STORAGE|accessToken/.test(line)).slice(0, 120).join("\n"));
  });
});
