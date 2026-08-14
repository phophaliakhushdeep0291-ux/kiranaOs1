import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * A mistyped or stale URL used to render the 404 card on its own, outside the
 * app shell. On a phone that meant the tab bar and top bar vanished, so the only
 * way out of a wrong link was the single button on the card, and because the
 * card also skipped `RouteTransition` the tab kept the previous screen's title
 * while screen readers were never told the page had changed.
 *
 * These assertions pin the shape of the fix rather than the copy: the catch-all
 * goes through the same LazyPage/shell path as every other screen, and it does
 * not borrow the gate that would call an unknown path a permissions problem.
 */
const routes = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const notFound = readFileSync(new URL("../components/shared/NotFound.tsx", import.meta.url), "utf8");

/** The catch-all's own body, so nothing here matches a sibling route by accident. */
function notFoundRouteSource() {
  const start = routes.indexOf("function NotFoundRoute()");
  expect(start, "NotFoundRoute is missing from routes.tsx").toBeGreaterThan(-1);
  const next = routes.indexOf("\nfunction ", start + 1);
  return routes.slice(start, next === -1 ? undefined : next);
}

describe("not-found route keeps the app shell", () => {
  it("routes the catch-all through NotFoundRoute, never the bare card", () => {
    expect(routes).toContain("<Route component={NotFoundRoute} />");
    expect(routes).not.toContain("<Route component={NotFound} />");
  });

  it("renders the card through LazyPage so the title and route announcement fire", () => {
    // Both branches — signed in and signed out — go through LazyPage, which is
    // what mounts RouteTransition (document.title + the aria-live announcement).
    const source = notFoundRouteSource();
    const lazyPageUses = source.match(/<LazyPage component=\{NotFound\} \/>/g) ?? [];
    expect(lazyPageUses).toHaveLength(2);
  });

  it("keeps the phone's navigation on screen for a signed-in shopkeeper", () => {
    const source = notFoundRouteSource();
    expect(source).toContain("<AppLayout pageTitle=\"Page not found\">");
    expect(source).toContain("<SessionLockGate>");
  });

  it("does not run the business-profile gate over an unknown path", () => {
    // That gate answers "not part of this business profile", which would tell a
    // shopkeeper a typo is a permissions problem.
    expect(notFoundRouteSource()).not.toContain("BusinessProfileRouteGate");
  });

  it("lets the shell title be overridden instead of naming a page that does not exist", () => {
    // Without the override, getPageTitle titlecases the last URL segment and the
    // shell announces "Also Bogus page loaded" for a screen nobody can open.
    expect(layout).toContain("pageTitle?: string");
    // `getPageTitle` takes the translator so the top bar is not the one piece of
    // chrome left in English; the override still wins ahead of it either way.
    expect(layout).toContain("const resolvedPageTitle = pageTitle ?? getPageTitle(loc, t);");
    // Both the desktop title and the mobile top bar read the resolved value.
    expect(layout.match(/resolvedPageTitle/g) ?? []).toHaveLength(3);
    expect(layout).not.toContain("pageTitle={getPageTitle(loc");
  });

  it("sizes the card so it fits the shell's scroll area", () => {
    // A 100vh box inside main's scroll area pushes a dead end half a screen
    // down. Checked on the class list, not the file, so the note explaining the
    // change is free to name the old utility.
    const classNames = [...notFound.matchAll(/className="([^"]*)"/g)].map((match) => match[1]);
    expect(classNames.some((value) => /\bmin-h-screen\b/.test(value))).toBe(false);
    expect(classNames.some((value) => /\bmin-h-\[\d+dvh\]/.test(value))).toBe(true);
  });
});
