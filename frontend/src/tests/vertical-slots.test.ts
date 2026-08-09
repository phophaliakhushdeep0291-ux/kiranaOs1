import { afterEach, describe, expect, it } from "vitest";
import { billingSlotsFor, resetBillingSlots } from "@/features/core/billing/billing-slots";
import { productConfiguratorFor, resetProductConfigurators } from "@/features/core/billing/product-configurators";
import { saveBusinessType } from "@/features/core/settings/business-type-store";
import { loadVerticalSlots } from "@/app/vertical-slots";
import { packForBusinessType } from "@/features/verticals/registry";
import type { Product } from "@/types/api";

/**
 * The slot seam, from a pack's declaration through to billing rendering a control.
 *
 * Worth pinning because the wiring is deliberately indirect and the failure is silent.
 * Both packs that own a control used to import it directly — pharmacy's
 * `import "./prescriptions/billing-slot"` and restaurant's
 * `import "./billing-addon-configurator"` — which registered them as a side effect of
 * the registry loading, for every shop of every trade, in the startup chunk. Closing
 * that leak moved registration to a dynamic import driven by the active pack, and
 * nothing would have noticed if it had simply stopped happening: billing renders no
 * control, the counter sells a Schedule H medicine with no slip attached and only the
 * server guard refuses, or a dish with add-ons is silently added plain.
 */

const scheduleHCart = { productIds: ["p1"], products: [{ drugSchedule: "h" }] };
const otcCart = { productIds: ["p2"], products: [{ drugSchedule: "" }] };
const dish = { id: "d1", name: "Paneer Tikka" } as Product;

describe("vertical billing slots", () => {
  afterEach(() => {
    resetBillingSlots();
    resetProductConfigurators();
  });

  it("registers the pharmacy prescription control for a pharmacy", async () => {
    expect(billingSlotsFor(scheduleHCart)).toEqual([]);

    await loadVerticalSlots(packForBusinessType("pharmacy"));

    expect(billingSlotsFor(scheduleHCart).map((slot) => slot.id)).toEqual(["prescriptionId"]);
  });

  it("shows it only when the cart actually holds a restricted medicine", async () => {
    await loadVerticalSlots(packForBusinessType("pharmacy"));

    // An OTC basket must not sprout a prescription control.
    expect(billingSlotsFor(otcCart)).toEqual([]);
  });

  it("registers the restaurant add-on dialog for a restaurant", async () => {
    saveBusinessType("restaurant");
    expect(productConfiguratorFor(dish)).toBeNull();

    await loadVerticalSlots(packForBusinessType("restaurant"));

    expect(productConfiguratorFor(dish)?.id).toBe("restaurant-addons");
  });

  it("registers nothing for a trade that declares no slots", async () => {
    saveBusinessType("kirana");

    for (const businessType of ["kirana", "clothing", "footwear"] as const) {
      await loadVerticalSlots(packForBusinessType(businessType));
    }

    // A kirana till must not be able to reach another trade's control at all.
    expect(billingSlotsFor(scheduleHCart)).toEqual([]);
    expect(productConfiguratorFor(dish)).toBeNull();
  });
});
