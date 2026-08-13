import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { SHOP_WORKFLOWS } from "@/features/core/settings/shop-workflows";
import { ROUTES as VOICE_ROUTES } from "@/features/core/voice/voice-command-parser";
import { VERTICAL_PACKS } from "@/features/verticals/registry";

/**
 * Every shortcut the app offers must land on a page that exists.
 *
 * `/udhar` was navigated to from the dashboard "Collect" action of eight
 * verticals, every voice "open udhar / khata" command and the sync-status deep
 * link, while `routes.tsx` never registered it — all of them quietly hit the
 * Not Found screen. Nothing failed, because no test compared the two lists.
 */

const routesSource = readFileSync(join(process.cwd(), "src/app/routes.tsx"), "utf8");

const REGISTERED = [
  ...[...routesSource.matchAll(/<Route path="([^"]+)"/g)].map((match) => match[1]),
  ...VERTICAL_PACKS.flatMap((pack) => pack.routes.map((route) => route.path)),
];

function pathOf(href: string) {
  return (href.split(/[?#]/)[0] || "/").replace(/\/+$/, "") || "/";
}

/** A registered `/bills/:id` satisfies a link to `/bills/42`. */
function isRegistered(href: string) {
  const target = pathOf(href).split("/");
  return REGISTERED.some((route) => {
    const pattern = route.split("/");
    return pattern.length === target.length
      && pattern.every((segment, index) => segment.startsWith(":") || segment === target[index]);
  });
}

function unresolved(hrefs: string[]) {
  return [...new Set(hrefs.filter((href) => href.startsWith("/") && !isRegistered(href)))];
}

describe("every navigation target resolves to a registered route", () => {
  it("found the route table at all", () => {
    // Guards the regex above: a refactor of routes.tsx that stopped matching
    // would otherwise turn every assertion below into a silent pass.
    expect(REGISTERED.length).toBeGreaterThan(50);
    expect(REGISTERED).toContain("/dashboard");
  });

  it("resolves every dashboard quick action of every business vertical", () => {
    const hrefs = (Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[])
      .flatMap((vertical) => BUSINESS_TYPE_DEFS[vertical].dashboard.quickActions.map((action) => action.href));

    expect(unresolved(hrefs)).toEqual([]);
  });

  it("resolves every shop-workflow action", () => {
    const hrefs = Object.values(SHOP_WORKFLOWS).flatMap((workflow) => workflow.actions.map((action) => action.href));

    expect(unresolved(hrefs)).toEqual([]);
  });

  it("resolves every route a voice command can navigate to", () => {
    expect(unresolved(VOICE_ROUTES.map((route) => route.route))).toEqual([]);
  });

  /**
   * "Outstanding Udhar" on the dashboard once opened a standalone page of its
   * own, so the same concept had two screens: the sidebar's "Customers / Udhar"
   * and a separate list that could not record a payment. The alias resolves to
   * the customer credit view, and that is the only udhar screen.
   */
  it("keeps the /udhar alias pointing at the customer credit view", () => {
    expect(isRegistered("/udhar")).toBe(true);
    expect(routesSource).toContain('<Redirect to="/customers?filter=udhar" />');
    expect(routesSource).not.toContain("component={Udhar}");
  });
});
