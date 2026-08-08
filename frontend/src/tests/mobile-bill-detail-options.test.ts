import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const billDetail = readFileSync(new URL("../features/core/bills/pages/BillDetailPage.tsx", import.meta.url), "utf8");

describe("phone bill item detail", () => {
  it("uses a card on phones and preserves the desktop table", () => {
    expect(billDetail).toContain('className="divide-y sm:hidden"');
    expect(billDetail).toContain('className="hidden overflow-x-auto sm:block"');
    expect(billDetail).toContain("<BillItemDescription item={item} />");
    expect(billDetail).toContain('aria-label="Selected add-ons"');
    expect(billDetail).toContain('href="/bills" className="inline-flex"');
  });
});
