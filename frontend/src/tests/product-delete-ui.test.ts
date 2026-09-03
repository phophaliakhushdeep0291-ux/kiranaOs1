import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("product delete UI", () => {
  const source = readFileSync("src/features/core/products/pages/ProductsPage.tsx", "utf8");

  it("shows local delete failures in the approval dialog", () => {
    expect(source).toContain("const [deleteError, setDeleteError]");
    expect(source).toContain("error={deleteError}");
    expect(source).toContain("products.toast.deleteFailed");
  });

  it("awaits deletion and applies the product permission on the mobile action", () => {
    expect(source).toContain("await deleteProduct.mutateAsync");
    expect(source.match(/if \(!manageProducts\.allowed\)/g)?.length).toBeGreaterThanOrEqual(3);
  });
});
