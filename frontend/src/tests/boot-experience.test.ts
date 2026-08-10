import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

describe("cold boot experience", () => {
  it("shows a neutral startup state and avoids a premature fatal timeout", () => {
    const html = readFileSync(fileURLToPath(new URL("../../index.html", import.meta.url)), "utf8");

    expect(html).toContain('id="artha-boot-wait"');
    expect(html).toContain("Opening your counter");
    expect(html).toContain("wait.parentNode === root");
    expect(html).toContain("}, 20000)");
    expect(html).toContain('window.addEventListener("error"');
    expect(html).toContain('window.addEventListener("unhandledrejection"');
  });
});
