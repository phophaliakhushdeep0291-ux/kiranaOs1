import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * The stock cards broke on a real shop's numbers.
 *
 * The badge shared a flex row with the value, and neither would give way: the
 * badge is `shrink-0`, and a text node will not shrink below its own width
 * without `min-w-0`. On a 375px phone the card's content box is 137px, and
 * "₹6,31,945.05" measures 131px at 21px bold — the pair needs about 179px. The
 * card is `overflow: visible`, so the badge escaped and landed on top of the
 * card next to it. Measured on production: 27px of spill.
 *
 * It only appears with real data. At ₹5,000 everything fits, which is why the
 * seeded four-width QA never saw it — the same blind spot that hid the Google
 * button overflow, and worth remembering when reading any "zero overflow"
 * evidence taken against fixture data.
 *
 * Source contracts, because there is no renderer here and the failure is a
 * layout one.
 */

const source = readFileSync("src/features/core/inventory/pages/InventoryPage.tsx", "utf8");

describe("the stock metric card holds a real shop's numbers", () => {
  it("does not put the badge in a row with the value", () => {
    // The exact shape that broke: label and value nested in one flex child
    // opposite a shrink-0 badge.
    expect(source).not.toContain(
      '<div className="flex items-start justify-between gap-3"><div><p className="text-[11px] font-medium text-[#6d7c98]">{label}</p>',
    );
  });

  it("pairs the badge with the label instead", () => {
    expect(source).toContain('<p className="min-w-0 text-[11px] font-medium text-[#6d7c98]">{label}</p>');
  });

  it("gives the value the full width of the card", () => {
    expect(source).toMatch(/<p className="mt-2 break-words text-\[21px\] font-bold leading-none tabular-nums/);
  });

  it("lets an absurd figure wrap rather than escape", () => {
    // Money is never truncated to make a layout work — a shopkeeper reading a
    // stock value needs all of it — so the backstop wraps.
    expect(source).toContain("break-words");
    expect(source).not.toContain("truncate text-[21px]");
  });

  it("keeps money in tabular figures", () => {
    expect(source).toContain("tabular-nums");
  });
});
