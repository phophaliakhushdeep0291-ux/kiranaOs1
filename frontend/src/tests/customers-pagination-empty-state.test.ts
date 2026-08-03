import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const customersPage = readFileSync("src/features/core/customers/pages/CustomersPage.tsx", "utf8");

describe("customers list count footer", () => {
  it("shows an honest empty count instead of fake pagination controls", () => {
    expect(customersPage).toContain("Showing 0 of ${total} customers");
    expect(customersPage).not.toContain('aria-label="Previous page"');
    expect(customersPage).not.toContain('aria-label="Next page"');
  });
});
