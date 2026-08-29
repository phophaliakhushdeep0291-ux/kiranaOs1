import { beforeEach, describe, expect, it, vi } from "vitest";

const active = vi.hoisted(() => ({ shop: "restaurant" }));
vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: active.shop, store_id: active.shop, device_id: "device" }),
  nowIso: () => "2026-08-29T12:00:00.000Z",
}));

import { withLocalEntityDefaults } from "@/lib/offline/repositories/base";
import { OfflineScopeMismatchError } from "@/lib/offline/db";

describe("offline write scope guard", () => {
  beforeEach(() => { active.shop = "restaurant"; });

  it("refuses an explicitly Kirana-labelled row while the restaurant is active", () => {
    expect(() => withLocalEntityDefaults({
      id: "product_1",
      tenant_id: "kirana",
      store_id: "kirana",
    }, "product")).toThrow(OfflineScopeMismatchError);
  });

  it("labels an unscoped server row only with the active restaurant", () => {
    expect(withLocalEntityDefaults({ id: "dish_1", name: "Dal" }, "product")).toMatchObject({
      id: "dish_1",
      tenant_id: "restaurant",
      store_id: "restaurant",
    });
  });
});
