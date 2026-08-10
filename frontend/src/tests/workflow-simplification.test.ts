import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

function read(relativePath: string) {
  return fs.readFileSync(path.resolve(process.cwd(), relativePath), "utf8");
}

describe("workflow simplification", () => {
  it("keeps purchase planning secondary to the core receiving workflow", () => {
    const source = read("src/features/core/purchases/pages/PurchaseBillsPage.tsx");

    expect(source).toContain('aria-label="Purchase workflow"');
    expect(source).toContain('"1. Order", "2. Receive stock", "3. Record bill", "4. Settle due"');
    expect(source).toContain("{showPlanning && <>");
  });

  it("uses a compact four-metric customer summary", () => {
    const source = read("src/features/core/customers/pages/CustomersPage.tsx");
    const summary = source.slice(source.indexOf('aria-label="Customer account summary"'), source.indexOf("</section>", source.indexOf('aria-label="Customer account summary"')));

    expect(summary.match(/<CustomerMetricCard/g)).toHaveLength(4);
  });
});
