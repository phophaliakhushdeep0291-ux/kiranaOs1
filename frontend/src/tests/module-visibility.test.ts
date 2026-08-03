import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MODULE_DEFS,
  MODULE_GROUPS,
  getModuleVisibility,
  isModuleEnabled,
  isModuleId,
  moduleForPath,
  patchModuleVisibility,
  sanitizeModuleVisibility,
  saveModuleVisibility,
  subscribeToModuleVisibility,
  type ModuleId,
} from "@/features/settings/modules";
import { saveBusinessType } from "@/features/settings/business-types";

const read = (relative: string) => readFileSync(join(process.cwd(), relative), "utf8");

const routes = read("src/app/routes.tsx");
const layout = read("src/components/layout/Layout.tsx");
const mobileChrome = read("src/components/layout/MobileAppChrome.tsx");
const settingsShell = read("src/features/settings/SettingsShell.tsx");
const dashboard = read("src/features/dashboard/pages/DashboardPage.tsx");
const modulesPage = read("src/features/settings/pages/ModulesSettingsPage.tsx");

// Hiding any of these would strand the shopkeeper: billing is the till, the
// dashboard is the way back, sync-status is how data safety is checked, and
// settings is the only way to switch a hidden module back on.
const NEVER_HIDEABLE = ["/dashboard", "/billing", "/settings", "/settings/modules", "/sync-status"];

describe("module registry", () => {
  it("describes every module with a unique id and a real group", () => {
    const ids = MODULE_DEFS.map((module) => module.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const module of MODULE_DEFS) {
      expect(isModuleId(module.id)).toBe(true);
      expect(MODULE_GROUPS).toContain(module.group);
      expect(module.label.length).toBeGreaterThan(3);
      expect(module.description.length).toBeGreaterThan(8);
      expect(module.paths.every((path) => path.startsWith("/"))).toBe(true);
    }
  });

  it("points every routed module at a route that actually exists", () => {
    for (const module of MODULE_DEFS.filter((entry) => entry.paths.length > 0)) {
      const routed = module.paths.some((path) => routes.includes(`<Route path="${path}"`));
      expect(routed, `${module.id} owns no registered route`).toBe(true);
    }
  });

  it("leaves the app's spine outside every module so it can never be hidden", () => {
    for (const path of NEVER_HIDEABLE) {
      expect(moduleForPath(path), `${path} must not be hideable`).toBeNull();
    }
  });
});

describe("route ownership", () => {
  it("resolves a nested route to the module that owns its deepest prefix", () => {
    expect(moduleForPath("/inventory/batches")).toBe("inventory");
    expect(moduleForPath("/products/abc-123/pricing")).toBe("products");
    expect(moduleForPath("/bills/9f2")).toBe("sales_history");
    expect(moduleForPath("/assurance/findings/7")).toBe("assurance");
    expect(moduleForPath("/customers/42")).toBe("customers");
  });

  it("ignores query strings, hashes and trailing slashes", () => {
    expect(moduleForPath("/reports?range=today")).toBe("reports");
    expect(moduleForPath("/expenses/")).toBe("expenses");
    expect(moduleForPath("/loyalty#tiers")).toBe("loyalty");
  });

  it("does not let one module swallow a similarly named route", () => {
    // "/customer-order" only shares a prefix string with "/customers".
    expect(moduleForPath("/customer-order")).toBeNull();
    expect(moduleForPath("/order/SHOP1")).toBeNull();
  });
});

describe("stored visibility", () => {
  it("treats an unset module as visible", () => {
    const stored = sanitizeModuleVisibility({ loyalty: false });
    expect(stored.loyalty).toBe(false);
    expect(stored.reports).toBeUndefined();
  });

  it("survives a settings blob that round-tripped booleans as numbers or strings", () => {
    const stored = sanitizeModuleVisibility({ loyalty: 0, offers: 1, staff: "false", reports: "true" });
    expect(stored).toEqual({ loyalty: false, offers: true, staff: false, reports: true });
  });

  it("drops keys that are not modules and junk payloads", () => {
    expect(sanitizeModuleVisibility({ loyalty: false, notAModule: false })).toEqual({ loyalty: false });
    expect(sanitizeModuleVisibility({ loyalty: "maybe" })).toEqual({});
    expect(sanitizeModuleVisibility(null)).toEqual({});
    expect(sanitizeModuleVisibility(["loyalty"])).toEqual({});
    expect(sanitizeModuleVisibility("loyalty")).toEqual({});
  });
});

describe("the live visibility store", () => {
  afterEach(() => {
    saveModuleVisibility({});
    saveBusinessType("kirana");
  });

  it("starts with every module on, except the trade-specific ones", () => {
    expect(getModuleVisibility()).toEqual({});
    // A module without defaultForBusinessTypes is on for every shop; one with it
    // waits for a matching business type (or an explicit switch) — see below.
    const general = MODULE_DEFS.filter((module) => !module.defaultForBusinessTypes);
    expect(general.every((module) => isModuleEnabled(module.id))).toBe(true);
    expect(general.length).toBeGreaterThan(0);
  });

  it("keeps a trade-specific module off by default for a shop of another trade", () => {
    // The test environment's stored business type is the "kirana" default, and a
    // grocery store has no use for a garment rental desk.
    saveBusinessType("kirana");
    expect(isModuleEnabled("rentals")).toBe(false);

    saveBusinessType("clothing");
    expect(isModuleEnabled("rentals")).toBe(true);
  });

  it("lets an explicit choice beat the business-type default in both directions", () => {
    saveBusinessType("kirana");
    patchModuleVisibility({ rentals: true });
    expect(isModuleEnabled("rentals")).toBe(true);

    saveBusinessType("clothing");
    patchModuleVisibility({ rentals: false });
    expect(isModuleEnabled("rentals")).toBe(false);
  });

  it("keeps every change when several switches are flipped in the same tick", () => {
    // Each toggle merges against the live store, not a render snapshot — the
    // stale-closure version of this dropped everything but the last click.
    patchModuleVisibility({ loyalty: false });
    patchModuleVisibility({ gift_cards: false });
    patchModuleVisibility({ offers: false });

    expect(getModuleVisibility()).toEqual({ loyalty: false, gift_cards: false, offers: false });
    expect(isModuleEnabled("loyalty")).toBe(false);
    expect(isModuleEnabled("reports")).toBe(true);
  });

  it("switches a module back on without disturbing the others", () => {
    patchModuleVisibility({ loyalty: false, staff: false });
    patchModuleVisibility({ loyalty: true });

    expect(isModuleEnabled("loyalty")).toBe(true);
    expect(isModuleEnabled("staff")).toBe(false);
  });

  it("notifies subscribers only when the stored value actually changes", () => {
    let notifications = 0;
    const stopListening = subscribeToModuleVisibility(() => { notifications += 1; });

    patchModuleVisibility({ loyalty: false });
    patchModuleVisibility({ loyalty: false });
    stopListening();

    expect(notifications).toBe(1);
  });
});

describe("module visibility wiring", () => {
  it("filters the desktop sidebar and keeps a group alive on its remaining children", () => {
    expect(layout).toContain("useModuleVisibility");
    expect(layout).toContain("useModuleVisibilityServerSync");
    expect(layout).toContain("const children = item.children.filter((child) => isHrefEnabled(child.href));");
    expect(layout).toContain("if (children.length === 0) continue;");
    expect(layout).toContain("{nav.map(item =>");
  });

  it("filters both mobile navigation surfaces", () => {
    expect(mobileChrome).toContain("useModuleVisibility");
    expect(mobileChrome).toContain("TOP_LEVEL_TABS.filter((tab) => isHrefEnabled(tab.href))");
    expect(mobileChrome).toContain("group.items.filter((item) => isHrefEnabled(item.href))");
    // A five-column stylesheet default cannot describe a filtered tab bar.
    expect(mobileChrome).toContain("gridTemplateColumns: `repeat(${tabs.length + 1}, minmax(0, 1fr))`");
  });

  it("hides the dashboard shortcuts and floating helpers for switched-off modules", () => {
    expect(dashboard).toContain("actions.filter((action) => isHrefEnabled(action.href))");
    expect(layout).toContain('isModuleOn("voice_assistant")');
    expect(layout).toContain('isModuleOn("report_issue")');
  });

  it("is reachable and writes through the shared settings blob", () => {
    expect(settingsShell).toContain('href: "/settings/modules"');
    expect(routes).toContain('<Route path="/settings/modules">');
    expect(modulesPage).toContain("patch({ moduleVisibility: patchVisibility({ [id]: on }) })");
  });

  it("covers every module in the settings screen through the shared group list", () => {
    expect(modulesPage).toContain("MODULE_GROUPS.map((group)");
    const grouped = new Set<ModuleId>();
    for (const group of MODULE_GROUPS) {
      for (const module of MODULE_DEFS.filter((entry) => entry.group === group)) grouped.add(module.id);
    }
    expect(grouped.size).toBe(MODULE_DEFS.length);
  });
});
