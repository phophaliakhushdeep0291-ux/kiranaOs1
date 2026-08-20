import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("src/features/core/bills/pages/BillsPage.tsx", "utf8");

describe("bill history touch targets", () => {
  it("gives table selection controls a 44px hit area without enlarging the visual checkbox", () => {
    expect(source).toContain('className="relative grid h-11 w-11 cursor-pointer place-items-center');
    expect(source).toContain('className="absolute inset-0 h-full w-full cursor-pointer opacity-0"');
    expect(source).toContain('"pointer-events-none h-4 w-4 rounded-[4px] border');
    expect(source).not.toContain('className="h-3.5 w-3.5 rounded border-[#cbd5e1]');
  });

  it("keeps destructive and overflow row actions at least 44px high", () => {
    expect(source).toContain('className="inline-flex h-11 items-center gap-1 whitespace-nowrap rounded-xl');
    expect(source).toContain('className="grid h-11 w-11 place-items-center rounded-xl');
    expect(source).not.toContain('className="inline-flex h-8 items-center gap-1 whitespace-nowrap');
    expect(source).not.toContain('className="grid h-8 w-8 place-items-center rounded-[7px]');
  });

  it("renders dashboard view-all links as real 44px controls", () => {
    expect(source.match(/className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-xl/g)).toHaveLength(2);
    expect(source).not.toContain('className="tap-target text-[11px] font-bold text-[var(--brand)]"');
  });
});
