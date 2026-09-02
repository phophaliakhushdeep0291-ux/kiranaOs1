import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const source = readFileSync(join(process.cwd(), "src/features/core/inventory/pages/components/StockMovementDialog.tsx"), "utf8");

describe("Stock Out write-off safety", () => {
  it("treats every non-counter removal as an owner-approved damage movement", () => {
    expect(source).toContain("const isWriteOff = reason !== OUT_REASONS[0].value");
    expect(source).toContain("setOwnerPinOpen(true)");
    expect(source).toContain("recordDamage.mutate(");
    expect(source).toContain("ownerPin }");
    expect(source).toContain("reasonRequired");
  });

  it("keeps ordinary counter stock-out on the idempotent manual sale path", () => {
    expect(source).toContain("recordSale.mutate(");
    expect(source.indexOf("if (isWriteOff)")).toBeLessThan(source.indexOf("recordSale.mutate("));
  });
});
