import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const guestMenu = readFileSync(new URL("../features/core/customer-order/DineInMenuPage.tsx", import.meta.url), "utf8");
const billingConfigurator = readFileSync(new URL("../features/verticals/restaurant/billing-addon-configurator.tsx", import.meta.url), "utf8");
const addonManager = readFileSync(new URL("../features/verticals/restaurant/pages/components/AddonManagerDialog.tsx", import.meta.url), "utf8");

describe("premium restaurant phone controls", () => {
  it("keeps guest menu controls at least 44px in their tapping dimension", () => {
    expect(guestMenu).toContain('className="h-11 w-full bg-transparent');
    expect(guestMenu).toContain('[scrollbar-width:none] [&::-webkit-scrollbar]:hidden');
    expect(guestMenu).toContain('className="flex min-h-11 min-w-11 shrink-0 items-center');
    expect(guestMenu).toContain('className="min-h-11 rounded-xl border-[1.5px]');
    expect(guestMenu).toContain('className="grid h-11 w-11 shrink-0 place-items-center rounded-full border"');
    expect(guestMenu).toContain('className="grid h-11 w-11 place-items-center rounded-lg"');
    expect(guestMenu).not.toContain('className="grid h-7 w-7 place-items-center rounded-lg"');
  });

  it("keeps staff add-on steppers and stock controls phone-safe", () => {
    expect(billingConfigurator).toContain('className="h-11 w-11" aria-label={`Decrease ${option.name}`}');
    expect(billingConfigurator).toContain('className="h-11 w-11" aria-label={`Increase ${option.name}`}');
    expect(billingConfigurator).toContain('<DialogFooter className="gap-2 max-sm:!flex-col sm:justify-between">');
    expect(billingConfigurator).toContain('t("restaurant.addons.configureHelp", { product: product.name })');
    expect(billingConfigurator).not.toContain('className="h-7 w-7"');
    expect(addonManager).toContain('className="mt-1 h-11 w-full rounded-md');
    expect(addonManager).toContain('className="h-11 w-11" aria-label={t("restaurant.addons.removeChoice"');
  });
});
