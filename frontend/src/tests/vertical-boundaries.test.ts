import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, saveBusinessType, type BusinessType } from "@/features/core/settings/business-types";
import { isModuleAvailable, isPathEnabled, setModulePathGate } from "@/features/core/settings/modules";
import {
  VERTICAL_PACKS,
  isVerticalPathActive,
  packForBusinessType,
  verticalForPath,
} from "@/features/verticals/registry";

/**
 * The isolation guarantee, enforced rather than agreed.
 *
 * One shop's trade must not be able to reach — or break — another's. That holds
 * only while the dependency arrows point one way: a vertical pack may build on
 * the shared core, but core must never reach back into a pack, and no pack may
 * reach sideways into another. Both directions are checked here, so breaking
 * the architecture fails the build instead of quietly shipping.
 */

const FEATURES = "src/features";
const CORE = join(FEATURES, "core");
const VERTICALS = join(FEATURES, "verticals");

function sourceFilesUnder(dir: string): string[] {
  const found: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry)) found.push(full);
    }
  };
  walk(dir);
  return found;
}

/** Every module specifier in a file, from static imports, type imports and dynamic import(). */
function importsOf(file: string): string[] {
  const source = readFileSync(file, "utf8");
  return [...source.matchAll(/(?:from|import)\s*\(?\s*["']([^"']+)["']/g)].map((match) => match[1]);
}

describe("vertical boundaries", () => {
  it("core never imports a vertical pack", () => {
    const offenders: string[] = [];
    for (const file of sourceFilesUnder(CORE)) {
      for (const specifier of importsOf(file)) {
        if (/(^@\/features\/verticals\/)|(\.\.\/verticals\/)/.test(specifier)) {
          offenders.push(`${relative(FEATURES, file).replace(/\\/g, "/")} -> ${specifier}`);
        }
      }
    }

    // Core is the shared spine every trade runs on. The moment it imports one
    // trade's code, that trade's bugs and releases become every shop's problem.
    expect(offenders).toEqual([]);
  });

  it("no vertical pack imports another vertical pack", () => {
    const packDirs = readdirSync(VERTICALS).filter((entry) => statSync(join(VERTICALS, entry)).isDirectory());
    const offenders: string[] = [];

    for (const pack of packDirs) {
      for (const file of sourceFilesUnder(join(VERTICALS, pack))) {
        for (const specifier of importsOf(file)) {
          const aliased = specifier.match(/^@\/features\/verticals\/([^/]+)/);
          const relative_ = specifier.match(/^\.\.\/([^/]+)\//);
          const other = aliased?.[1] ?? (relative_ && packDirs.includes(relative_[1]) ? relative_[1] : null);
          if (other && other !== pack) {
            offenders.push(`${pack} -> ${other} (${relative(VERTICALS, file).replace(/\\/g, "/")})`);
          }
        }
      }
    }

    // Sideways imports are how one trade quietly becomes a dependency of
    // another. Shared code belongs in core, not in a sibling pack.
    expect(offenders).toEqual([]);
  });

  it("claims every business type exactly once", () => {
    const claims = new Map<BusinessType, string[]>();
    for (const pack of VERTICAL_PACKS) {
      for (const businessType of pack.businessTypes) {
        claims.set(businessType, [...(claims.get(businessType) ?? []), pack.id]);
      }
    }

    const all = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];
    expect(all.filter((businessType) => !claims.has(businessType))).toEqual([]);
    expect([...claims].filter(([, packs]) => packs.length > 1)).toEqual([]);

    // A new business type must not silently inherit another trade's screens.
    for (const businessType of all) {
      expect(packForBusinessType(businessType).businessTypes).toContain(businessType);
    }
  });

  it("routes a pack serves are covered by the paths it declares", () => {
    for (const pack of VERTICAL_PACKS) {
      for (const route of pack.routes) {
        // Path ownership is what hides another trade's entry points, so a route
        // the pack forgot to claim would still be reachable from the sidebar.
        expect(verticalForPath(route.path.split("/:")[0])).toBe(pack.id);
      }
    }
  });

  it("keeps one trade's paths out of another trade's app", () => {
    expect(verticalForPath("/rentals")).toBe("clothing");
    // Core routes belong to no pack and stay reachable for every shop.
    expect(verticalForPath("/billing")).toBeNull();
    expect(verticalForPath("/customers")).toBeNull();
  });
});

describe("vertical gate", () => {
  // What `app/providers.tsx` wires up at startup.
  beforeAll(() => setModulePathGate(isVerticalPathActive));
  afterAll(() => {
    setModulePathGate(() => true);
    saveBusinessType("kirana");
  });

  it("gives a clothing shop its own trade's screens", () => {
    saveBusinessType("clothing");

    expect(isVerticalPathActive("/rentals")).toBe(true);
    expect(isPathEnabled("/rentals")).toBe(true);
    expect(isModuleAvailable("rentals")).toBe(true);
  });

  it("keeps another trade's screens away from a kirana shop", () => {
    saveBusinessType("kirana");

    // Not merely hidden: the route is never registered for this shop, so the
    // sidebar, the mobile drawer, the command palette and the Settings switch
    // all read the same "not yours" from one place.
    expect(isVerticalPathActive("/rentals")).toBe(false);
    expect(isPathEnabled("/rentals")).toBe(false);
    expect(isModuleAvailable("rentals")).toBe(false);
  });

  it("leaves the shared spine reachable for every trade", () => {
    for (const businessType of Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[]) {
      saveBusinessType(businessType);
      for (const path of ["/billing", "/dashboard", "/customers", "/products", "/settings"]) {
        expect(isPathEnabled(path), `${path} unreachable for ${businessType}`).toBe(true);
      }
    }
  });
});
