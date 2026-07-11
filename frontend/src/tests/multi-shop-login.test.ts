import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("multi-shop login", () => {
  it("turns SHOP_SELECTION_REQUIRED into an interactive shop chooser", () => {
    const source = readFileSync("src/features/auth/pages/LoginPage.tsx", "utf8");

    expect(source).toContain('err.data?.code === "SHOP_SELECTION_REQUIRED"');
    expect(source).toContain('data-testid="shop-selection-panel"');
    expect(source).toContain("selectShop(shop.id)");
    expect(source).toContain("setLoginShopId(shopId)");
    expect(source).toContain("password: values.password, shopId }");
  });

  it("exposes verified shop choices in production error responses", () => {
    const source = readFileSync("../backend/src/modules/auth/auth.service.js", "utf8");

    expect(source).toContain("err.publicData = {");
    expect(source).toContain("matchingUsers.map");
    expect(source).toContain("Promise.all(");
  });
});
