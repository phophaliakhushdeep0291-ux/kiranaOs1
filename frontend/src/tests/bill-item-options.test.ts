import { describe, expect, it } from "vitest";
import { billItemAddons, billItemAddonSummary } from "@/features/core/bills/bill-item-options";

describe("persisted bill item options", () => {
  it("keeps server snapshots readable after the menu changes", () => {
    const item = {
      name: "Truffle Paneer Flatbread",
      addons: [
        { optionId: "mozzarella", groupName: "Finish your plate", name: "Smoked mozzarella", price: 85, quantity: 1 },
        { option_id: "oil", group_name: "Finish your plate", name: "Chili oil", price_delta: 0, quantity: 2 },
      ],
    };

    expect(billItemAddons(item)).toEqual([
      { optionId: "mozzarella", groupName: "Finish your plate", name: "Smoked mozzarella", price: 85, quantity: 1 },
      { optionId: "oil", groupName: "Finish your plate", name: "Chili oil", price: 0, quantity: 2 },
    ]);
    expect(billItemAddonSummary(item)).toBe("Smoked mozzarella, 2× Chili oil");
  });

  it("ignores malformed option rows instead of inventing receipt labels", () => {
    expect(billItemAddons({ addons: [null, {}, { name: "" }] })).toEqual([]);
  });
});
