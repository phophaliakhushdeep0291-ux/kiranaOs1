import { readFileSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { NAV, buildSidebarNav } from "@/components/layout/Layout";
import { MORE_GROUPS } from "@/components/layout/MobileAppChrome";
import { BUSINESS_TYPE_DEFS, categoryLabelKey, saveBusinessType, type BusinessType } from "@/features/core/settings/business-types";
import { englishTranslations, loadHindiDictionary, type TranslationKey } from "@/features/core/settings/i18n";
import { SHARED_NAVIGATION, isPathInBusinessProfile } from "@/features/core/settings/business-profile-bootstrap";
import { isPathEnabled, setModulePathGate } from "@/features/core/settings/modules";
import { VERTICAL_PACKS, isVerticalPathActive, packForBusinessType } from "@/features/verticals/registry";

/**
 * What each of the twelve shop types actually ends up looking at.
 *
 * The sidebar is assembled from three files that never mention each other: the
 * core spine in `Layout`, the trade's own entries in its `pack.ts`, and the
 * relabelling in `business-types`. Each is correct read alone. The defects live
 * in the merge — an anchor that does not exist, a mobile section named
 * something the drawer has never heard of, a trade whose two menu screens end up
 * with the same word on both. None of those throw; the entry just lands
 * somewhere else, or silently does not land at all.
 */

const BUSINESS_TYPES = Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[];

const TOP_LEVEL_HREFS = new Set(NAV.flatMap((item) => (item.kind === "link" ? [item.href] : [])));
const GROUP_ANCHORS = new Set(
  NAV.flatMap((item) =>
    item.kind === "group" ? [...(item.overviewHref ? [item.overviewHref] : []), ...item.children.map((c) => c.href)] : [],
  ),
);
const MOBILE_GROUP_NAMES = new Set(MORE_GROUPS.map((group) => group.label));

/**
 * Every label a shop of this trade reads down its sidebar, core spine included.
 *
 * Resolved through a real dictionary rather than compared as keys: the trade's
 * four relabelled entries are `TranslationKey`s now, and two DIFFERENT keys can
 * still land on the same word. Only the rendered string can answer whether one
 * shop is shown the same label twice, which is why the collision check below
 * runs this in both languages.
 */
function sidebarLabels(businessType: BusinessType, translate: (key: TranslationKey) => string): string[] {
  const { navConfig } = BUSINESS_TYPE_DEFS[businessType];
  const overrides: Record<string, string> = {
    "/billing": translate(navConfig.billing),
    "/products": translate(navConfig.products),
    "/inventory": translate(navConfig.inventory),
    "/customers": translate(navConfig.udhar),
  };
  const core = NAV.flatMap((item) =>
    item.kind === "link"
      ? [overrides[item.href] ?? item.label]
      : [
          // A group shows its own heading, which the `/inventory` override renames,
          // and then each child under it.
          (item.overviewHref && overrides[item.overviewHref]) || item.label,
          ...item.children.map((child) => overrides[child.href] ?? child.label),
        ],
  );
  return [...core, ...packForBusinessType(businessType).nav.map((entry) => translate(entry.label))];
}

describe("navigation fits every shop type", () => {
  it("covers all twelve trades, each with exactly one pack", () => {
    // Guards the sweep itself: a missing trade would make every case below vacuous.
    expect(BUSINESS_TYPES).toHaveLength(12);
    const claimed = VERTICAL_PACKS.flatMap((pack) => pack.businessTypes);
    expect([...claimed].sort()).toEqual([...BUSINESS_TYPES].sort());
  });

  it("anchors every trade entry to an href the sidebar actually has", () => {
    // `insertAfter` is a promise that the entry lands next to something. An anchor
    // that is neither a top-level link nor part of a group is a typo, and the entry
    // ends up exiled to the bottom of the sidebar with no sign anything went wrong.
    const dangling: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      for (const entry of pack.nav) {
        if (!entry.insertAfter) continue;
        if (TOP_LEVEL_HREFS.has(entry.insertAfter) || GROUP_ANCHORS.has(entry.insertAfter)) continue;
        dangling.push(`${pack.id} ${entry.href} → insertAfter "${entry.insertAfter}" is not in NAV`);
      }
    }
    expect(dangling).toEqual([]);
  });

  it("lands a trade entry beside its anchor, not at the bottom of the list", () => {
    // The anchor existing is not the same as the anchor working. `insertAfter`
    // used to be honoured only for top-level links, so an entry anchored to a
    // group — or to a row inside one — fell through to the tail above Settings.
    // Nothing threw; the screen was simply somewhere else. Assert the position.
    const misplaced: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      const built = buildSidebarNav(pack.nav, () => true, (key) => englishTranslations[key]);
      const hrefAt = (index: number) => {
        const item = built[index];
        return item?.kind === "link" ? item.href : undefined;
      };
      for (const entry of pack.nav) {
        if (!entry.insertAfter) continue;
        const anchor = built.findIndex((item) =>
          item.kind === "link"
            ? item.href === entry.insertAfter
            : item.overviewHref === entry.insertAfter || item.children.some((c) => c.href === entry.insertAfter),
        );
        const placed = built.findIndex((item) => item.kind === "link" && item.href === entry.href);
        if (anchor === -1) { misplaced.push(`${pack.id} ${entry.href}: anchor ${entry.insertAfter} missing`); continue; }
        // Directly after the anchor, allowing for a sibling entry sharing it.
        if (placed <= anchor) misplaced.push(`${pack.id} ${entry.href} sits before its anchor ${entry.insertAfter}`);
        else if (placed > anchor + 2) {
          misplaced.push(`${pack.id} ${entry.href} landed at ${placed} (after ${hrefAt(placed - 1) ?? "a group"}), anchor ${entry.insertAfter} is at ${anchor}`);
        }
      }
    }
    expect(misplaced).toEqual([]);
  });

  it("puts every phone entry in a drawer section that exists", () => {
    // The drawer matches on the section's LABEL. A name it does not recognise is
    // not an error — the entry is simply dropped, which reads exactly like a pack
    // that chose to stay desktop-only. Manufacturing's only screen vanished this
    // way, leaving a factory with no way to reach it from a phone at all.
    const homeless: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      for (const entry of pack.nav) {
        if (!entry.mobile) continue;
        if (MOBILE_GROUP_NAMES.has(entry.mobile.group)) continue;
        homeless.push(`${pack.id} ${entry.href} → mobile group "${entry.mobile.group}" is not a drawer section`);
      }
    }
    expect(homeless).toEqual([]);
  });

  it("gives every trade a reachable page for each of its own routes", () => {
    // A pack that mounts a route but never offers a way in is a screen only a
    // typed URL can find.
    const unreachable: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      const navHrefs = new Set(pack.nav.map((entry) => entry.href));
      for (const route of pack.routes) {
        if (route.path.includes(":")) continue; // detail screens are reached from their list
        if (navHrefs.has(route.path)) continue;
        unreachable.push(`${pack.id} route ${route.path} has no nav entry`);
      }
    }
    expect(unreachable).toEqual([]);
  });

  it("never shows one shop the same word twice, in either language", async () => {
    // Two entries reading "Menu" that open different screens is not a cosmetic
    // problem — it is the sidebar telling the owner the app has two of something
    // it has one of, and hiding the specialist screen behind the generic one.
    // Hindi has to be checked separately: two trades' keys can be distinct in
    // English and collapse onto one word in translation.
    const hindi = await loadHindiDictionary();
    expect(hindi, "Hindi table failed to load — the Hindi case below would be vacuous").toBeTruthy();
    const languages: Array<[string, (key: TranslationKey) => string]> = [
      ["en", (key) => englishTranslations[key]],
      ["hi", (key) => hindi?.[key] ?? englishTranslations[key]],
    ];

    const collisions: string[] = [];
    for (const [language, translate] of languages) {
      for (const businessType of BUSINESS_TYPES) {
        const seen = new Set<string>();
        for (const label of sidebarLabels(businessType, translate)) {
          if (seen.has(label)) collisions.push(`${language} ${businessType}: "${label}" appears twice`);
          seen.add(label);
        }
      }
    }
    expect(collisions).toEqual([]);
  });

  it("answers every shop-type key in Hindi, not with an English fallback", () => {
    // `t()` falls back to English for a missing key, so a forgotten translation
    // is invisible at runtime — the counter just reads English. The dictionary
    // completeness test catches a missing key; this catches the narrower case of
    // the twelve trades specifically, and names the trade that is short.
    const untranslated: string[] = [];
    for (const businessType of BUSINESS_TYPES) {
      const def = BUSINESS_TYPE_DEFS[businessType];
      const keys: TranslationKey[] = [
        def.labelKey, def.descriptionKey, def.voiceExampleKey,
        def.navConfig.billing, def.navConfig.products, def.navConfig.inventory,
        def.navConfig.udhar, def.navConfig.tagline,
        def.dashboard.heroTitle, def.dashboard.heroSubtitle, def.dashboard.creditLabel,
        def.dashboard.kpi.revenue, def.dashboard.kpi.profit, def.dashboard.kpi.credit, def.dashboard.kpi.cash,
        ...def.dashboard.quickActions.map((action) => action.label),
      ];
      for (const key of keys) {
        if (!(key in englishTranslations)) untranslated.push(`${businessType}: ${key} has no English entry`);
      }
      // Every category the trade ships with needs a word too, or the product
      // form shows a raw key where the shop expects its own vocabulary.
      for (const category of def.categories) {
        if (!categoryLabelKey(category)) untranslated.push(`${businessType}: category "${category}" has no label key`);
      }
    }
    expect(untranslated).toEqual([]);
  });

  it("keeps every dashboard shortcut pointing somewhere the shop can go", () => {
    // A quick action is the widest button on the dashboard. Pointing one at a
    // route belonging to ANOTHER trade would hand a shopkeeper a dead tile.
    const foreign: string[] = [];
    for (const businessType of BUSINESS_TYPES) {
      const own = packForBusinessType(businessType);
      const ownPaths = new Set(own.paths);
      for (const action of BUSINESS_TYPE_DEFS[businessType].dashboard.quickActions) {
        const owner = VERTICAL_PACKS.find((pack) => pack.paths.some((path) => action.href === path));
        if (!owner || ownPaths.has(action.href)) continue;
        foreign.push(`${businessType}: quick action "${action.label}" → ${action.href} belongs to ${owner.id}`);
      }
    }
    expect(foreign).toEqual([]);
  });
});

/**
 * Each trade walked end to end, through all three gates at once.
 *
 * `general-store-reachability.test.ts` does this for kirana, the default a new
 * shop lands on. The other eleven had no equivalent, and a screen is only
 * actually usable when the vertical gate, the owner's module switches and the
 * server's business profile all agree — each one passes on its own while a
 * screen stays walled off behind the third.
 *
 * The navigation list is read from the backend profile that will really answer,
 * rather than restated here, so a key renamed on the server fails this test
 * instead of quietly hiding a trade's own screen.
 */
function backendNavigationFor(verticalDir: string): string[] {
  const source = readFileSync(`../backend/src/verticals/${verticalDir}/navigation.js`, "utf8");
  const body = source.slice(source.indexOf("["), source.indexOf("]"));
  const trade = [...body.matchAll(/"([a-z0-9-]+)"/g)].map((match) => match[1]);
  return [...new Set([...trade, ...SHARED_NAVIGATION])];
}

describe("every trade can reach its own screens and no one else's", () => {
  const previous = "kirana" as BusinessType;
  beforeAll(() => setModulePathGate(isVerticalPathActive));
  afterAll(() => {
    setModulePathGate(() => true);
    saveBusinessType(previous);
  });

  it("reads a real navigation list for each of the twelve packs", () => {
    // Guards the reader: an empty list would make every case below vacuous, and
    // `isPathInBusinessProfile` treats a missing list as "allow everything".
    for (const pack of VERTICAL_PACKS) {
      const navigation = backendNavigationFor(pack.id);
      expect(navigation.length, `${pack.id} navigation`).toBeGreaterThan(SHARED_NAVIGATION.length);
      expect(navigation).toContain("inventory");
    }
  });

  it("opens every screen each trade's own pack mounts", () => {
    const blocked: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      const navigation = backendNavigationFor(pack.id);
      saveBusinessType(pack.businessTypes[0]);
      for (const entry of pack.nav) {
        if (!isPathEnabled(entry.href)) blocked.push(`${pack.id}: ${entry.href} blocked by the vertical/module gate`);
        if (!isPathInBusinessProfile(entry.href, navigation)) blocked.push(`${pack.id}: ${entry.href} not in its own server profile`);
      }
    }
    // A sidebar row that lands on "Not part of this business profile" is worse
    // than no row: the shop was told it had the feature.
    expect(blocked).toEqual([]);
  });

  it("keeps the shared counter reachable whatever the trade", () => {
    // Billing, stock, customers and the money screens are not trade features. A
    // vertical that forgets to list them must not lose them.
    const spine = ["/billing", "/products", "/inventory", "/customers", "/reports", "/money-statement", "/expenses", "/settings"];
    const blocked: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      const navigation = backendNavigationFor(pack.id);
      saveBusinessType(pack.businessTypes[0]);
      for (const path of spine) {
        if (!isPathEnabled(path)) blocked.push(`${pack.id}: ${path} blocked by the vertical/module gate`);
        if (!isPathInBusinessProfile(path, navigation)) blocked.push(`${pack.id}: ${path} not in server profile`);
      }
    }
    expect(blocked).toEqual([]);
  });

  it("never lets one trade reach another trade's screens", () => {
    // Reachability must not have been bought by opening the gates for everyone.
    const leaked: string[] = [];
    for (const pack of VERTICAL_PACKS) {
      saveBusinessType(pack.businessTypes[0]);
      for (const other of VERTICAL_PACKS) {
        if (other.id === pack.id) continue;
        for (const path of other.paths) {
          if (isPathEnabled(path)) leaked.push(`${pack.id} can reach ${other.id}'s ${path}`);
        }
      }
    }
    expect(leaked).toEqual([]);
  });
});
