import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const routes = readFileSync(new URL("../app/routes.tsx", import.meta.url), "utf8");
const routeTransition = readFileSync(new URL("../components/shared/RouteTransition.tsx", import.meta.url), "utf8");
const pageLoading = readFileSync(new URL("../components/shared/PageLoading.tsx", import.meta.url), "utf8");
const skeleton = readFileSync(new URL("../components/ui/skeleton.tsx", import.meta.url), "utf8");
const layout = readFileSync(new URL("../components/layout/Layout.tsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../index.css", import.meta.url), "utf8");

describe("product-wide route transition system", () => {
  it("wraps every lazy route in one keyed ready transition", () => {
    expect(routes).toContain('className="app-route-frame min-w-0"');
    expect(routes).toContain("<RouteTransition routeKey={routeKey}>");
    expect(routeTransition).toContain('className="app-route-ready min-w-0"');
  });

  it("resets the application scroll position precisely on page changes", () => {
    expect(routes).toContain('document.getElementById("main-content")');
    expect(routes).toContain('behavior: "auto"');
    expect(layout).not.toContain("overflow-auto scroll-smooth");
  });

  it("uses contextual loading copy and stable accessible placeholders", () => {
    expect(routes).toContain("ROUTE_LOADING_LABELS");
    expect(routes).toContain("Preparing today’s dashboard…");
    expect(routes).toContain("Opening a new bill…");
    expect(pageLoading).toContain('aria-busy="true"');
    expect(skeleton).toContain("app-skeleton-shimmer");
  });

  it("keeps premium motion short and respects reduced-motion preferences", () => {
    expect(styles).toContain("@keyframes app-route-enter");
    const routeDuration = styles.match(/app-route-enter\s+(\d+)ms/)?.[1];
    expect(routeDuration).toBeTruthy();
    expect(Number(routeDuration)).toBeLessThanOrEqual(250);
    expect(styles).toContain("@keyframes app-skeleton-shimmer");
    expect(styles).toContain("@media (prefers-reduced-motion: reduce)");
  });

  it("updates browser titles to preserve the Artha brand identity", () => {
    expect(routeTransition).toContain('`${label} · Artha`');
  });
});
