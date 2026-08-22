import { describe, expect, it } from "vitest";
import { customerFilterFromSearch } from "@/features/core/customers/pages/CustomersPage";

describe("customer credit deep-link filter", () => {
  it("maps the Udhar alias query to the outstanding-balance view", () => {
    expect(customerFilterFromSearch("?filter=udhar")).toBe("udhar");
  });

  it("accepts every supported customer view and rejects unknown values", () => {
    for (const filter of ["bad", "due", "promise", "cleared"] as const) {
      expect(customerFilterFromSearch(`?filter=${filter}`)).toBe(filter);
    }
    expect(customerFilterFromSearch("?filter=anything-else")).toBe("all");
    expect(customerFilterFromSearch("")).toBe("all");
  });
});
