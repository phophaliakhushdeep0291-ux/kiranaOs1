import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const source = readFileSync("src/components/ui/select.tsx", "utf8");

describe("shared select dropdown scrolling", () => {
  it("caps long option lists and does not pin the viewport to one trigger row", () => {
    expect(source).toContain("overflow-y-auto");
    expect(source).toContain("max-h-[min(max(var(--radix-select-content-available-height,0px),12rem),24rem)]");
    expect(source).toContain("w-full min-w-[var(--radix-select-trigger-width)]");
    expect(source).not.toContain("h-[var(--radix-select-trigger-height)]");
  });
});
