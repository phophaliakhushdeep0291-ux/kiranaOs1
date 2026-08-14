import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/** Every .tsx under a directory, with its text, for whole-tree invariants. */
function sourceFiles(dir: string): Array<{ path: string; text: string }> {
  const found: Array<{ path: string; text: string }> = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current)) {
      const full = join(current, entry);
      if (statSync(full).isDirectory()) walk(full);
      else if (entry.endsWith(".tsx")) found.push({ path: full.replace(/\\/g, "/"), text: readFileSync(full, "utf8") });
    }
  };
  walk(dir);
  return found;
}

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");
const mobileChrome = readFileSync("src/components/layout/MobileAppChrome.tsx", "utf8");
const styles = readFileSync("src/index.css", "utf8");
const routeTransition = readFileSync("src/components/shared/RouteTransition.tsx", "utf8");

/** Every `href:` inside one navigation literal, found by balancing its brackets. */
function navHrefs(source: string, declaration: string) {
  const open = source.indexOf(declaration);
  if (open === -1) throw new Error(`Navigation literal not found: ${declaration}`);
  let depth = 0;
  let end = open + declaration.length - 1;
  for (let i = end; i < source.length; i += 1) {
    if (source[i] === "[") depth += 1;
    else if (source[i] === "]" && (depth -= 1) === 0) { end = i; break; }
  }
  return [...source.slice(open, end).matchAll(/href:\s*"([^"]+)"/g)].map((match) => match[1]);
}

describe("route entry animation cannot strand the page", () => {
  // This has now broken the layout twice from opposite ends. `both`/`forwards`
  // left an identity transform behind, so page-level `position: fixed` chrome
  // anchored to the scrolling page box; `backwards` pinned the opening frame —
  // `opacity: 0` plus a 6px drop — so a document that was laid out but not yet
  // painting rendered invisible, 6px low, and 6px taller than the viewport.
  // Both failures share one cause: a decorative animation owning the resting
  // state of the page. These assertions keep the resting state authoritative.

  it("keeps the flourish off the element unless the page can actually paint", () => {
    // A hidden document's animation clock never advances — the exact condition
    // that used to strand the page — and the check has to be synchronous, or
    // the settled page paints once and then flashes back to transparent.
    expect(routeTransition).toContain('document.visibilityState === "visible"');
    expect(routeTransition).toContain("app-route-animate");
    // The animation must hang off the opt-in class, never the base class, or
    // the resting state stops being the correct one.
    expect(styles).toContain(".app-route-ready.app-route-animate {");
    expect(styles).not.toMatch(/\.app-route-ready\s*\{[^}]*animation:/);
  });

  it("never fills a transform keyframe in either direction", () => {
    for (const animation of ["app-route-enter", "app-data-enter"]) {
      const declaration = new RegExp(`animation:\\s*${animation}[^;]*;`, "g");
      const uses = styles.match(declaration) ?? [];
      expect(uses.length, `${animation} is not declared`).toBeGreaterThan(0);
      for (const use of uses) {
        // `forwards`/`both` re-creates the containing-block bug; `backwards`
        // re-creates the stranded-opening-frame bug. No fill mode is correct.
        expect(use, `${animation} must not set a fill mode`).not.toMatch(/forwards|backwards|both/);
      }
    }
  });

  it("still resolves both entry keyframes back to a clean resting state", () => {
    // Reduced motion is the other path to the resting state and must clear the
    // transform outright rather than leaving an identity matrix behind.
    expect(styles).toContain("animation: none !important;");
    expect(styles).toContain("transform: none !important;");
  });
});

describe("mobile panels stay inside the viewport the user can see", () => {
  it("sizes every slide-over to the dynamic viewport, not the large one", () => {
    // These panels are `position: fixed`, so `h-full` resolves against the
    // large viewport — the address-bar-hidden one — while their sticky action
    // row sits on the panel's bottom edge. On a phone with the address bar
    // showing, that puts Cancel/Save below the fold.
    const panels = sourceFiles("src/features").filter((file) => file.text.includes("app-slide-panel"));
    expect(panels.length).toBeGreaterThan(5);
    const largeViewport = panels
      .filter((file) => /app-slide-panel[^"'`]*\bh-full\b/.test(file.text))
      .map((file) => file.path);
    expect(largeViewport).toEqual([]);
    expect(styles).not.toMatch(/\.purchase-panel\s*\{[^}]*\bh-full\b/);
  });
});

describe("desktop app shell behavior", () => {
  it("keeps the sidebar fixed while the page content scrolls", () => {
    // Shell locks its own height (mobile via 100dvh, desktop via h-screen) and hides its own
    // overflow, so the <main> region is the only scroll container — never the body. This is what
    // lets mobile swipe-scroll work instead of forcing the user to drag the scrollbar.
    expect(layout).toContain("app-shell-root");
    expect(styles).toContain(".app-shell-root");
    expect(styles).toContain("height: 100dvh");
    // Sidebar is pinned to the viewport, content is offset by its (variable) width.
    expect(layout).toContain("app-desktop-sidebar");
    expect(styles).toContain("position: fixed");
    expect(styles).toContain("margin-left: var(--app-sidebar-width)");
    // The main region is the lone scroll container.
    expect(layout).toContain('id="main-content"');
    expect(layout).toContain("flex-1 overflow-auto");
  });

  it("lets desktop users resize and collapse the sidebar", () => {
    // Resize: persisted width, rAF-batched live updates pushed onto a CSS var on the shell.
    expect(layout).toContain("SIDEBAR_WIDTH_KEY");
    expect(layout).toContain("handleResize");
    expect(layout).toContain("requestAnimationFrame");
    expect(layout).toContain("shellRef.current?.style.setProperty");
    expect(layout).toContain("transition-none");
    expect(styles).toContain("will-change: width");
    expect(layout).toContain("Resize sidebar");
    // Collapse: dedicated collapse/expand controls backed by a persisted flag.
    expect(layout).toContain("setCollapsed");
    expect(layout).toContain("Collapse sidebar");
    expect(layout).toContain("Expand sidebar");
  });

  it("inherits a stable section title on record-detail routes", () => {
    expect(layout).toContain('loc.startsWith(`${path}/`)');
    expect(layout).toContain('"/bills": "Billing History"');
    expect(layout).toContain('"/customers": "Customers / Udhar"');
  });

  it("keeps mobile bottom navigation in its own row so it cannot cover page actions", () => {
    expect(layout).toContain("pb-[var(--app-mobile-content-bottom-clearance)] lg:pb-0");
    expect(mobileChrome).toContain("mx-3 mb-3 mt-2 shrink-0");
    expect(layout).not.toContain("fixed inset-x-3 bottom-3");
    expect(styles).toContain("min-height: 56px");
    expect(styles).toContain("calc(8px + env(safe-area-inset-bottom))");
    expect(layout).toContain("overscroll-contain");
  });

  it("puts every sidebar destination within reach of a phone", () => {
    // The sidebar is desktop-only, so any screen listed there and nowhere else
    // is simply unreachable on a phone — which is how Billing History, the six
    // stock-movement screens, Activity & Insights and the whole assurance
    // section went missing. The drawer is the phone's sidebar: it has to carry
    // the same destinations, whether as a row or inside an expandable section.
    const desktop = navHrefs(layout, "const NAV: NavItem[] = [");
    const mobile = [
      ...navHrefs(mobileChrome, "const MORE_GROUPS: Array<{ label: string; items: NavigationItem[] }> = ["),
      ...navHrefs(mobileChrome, "const TOP_LEVEL_TABS: Array<{ href: string; labelKey: TranslationKey; Icon: NavIcon; matches: string[] }> = ["),
    ];

    expect(desktop.length).toBeGreaterThan(20);
    expect(desktop.filter((href) => !mobile.includes(href))).toEqual([]);
  });

  it("uses one task-oriented mobile shell with stable top-level destinations", () => {
    expect(layout).toContain("<MobileTopBar");
    expect(layout).toContain("<MobileBottomNav");
    expect(layout).not.toContain("Legacy mobile topbar");
    expect(layout).not.toContain("Legacy mobile navigation");
    // The tab bar names its destinations through the catalogue now. The contract is
    // the same four stable tabs, so each key is checked on the shell and its English
    // wording where that wording now lives — a renamed tab still fails this.
    const shellEn = readFileSync("src/features/core/settings/translations/shell.ts", "utf8");
    for (const [key, label] of [["home", "Home"], ["sell", "Sell"], ["stock", "Stock"], ["customers", "Customers"]]) {
      expect(mobileChrome).toContain(`labelKey: "chrome.tab.${key}"`);
      expect(shellEn).toContain(`"chrome.tab.${key}": "${label}"`);
    }
    expect(mobileChrome).toContain("Open all app areas");
    expect(mobileChrome).toContain("Search products, bills, customers");
    expect(mobileChrome).toContain("Backup & sync");
  });
});
