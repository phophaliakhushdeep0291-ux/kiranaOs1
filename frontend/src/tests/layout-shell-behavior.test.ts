import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");
const mobileChrome = readFileSync("src/components/layout/MobileAppChrome.tsx", "utf8");
const styles = readFileSync("src/index.css", "utf8");

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

  it("keeps mobile bottom navigation in its own row so it cannot cover page actions", () => {
    expect(layout).toContain("pb-[var(--app-mobile-content-bottom-clearance)] lg:pb-0");
    expect(mobileChrome).toContain("mx-3 mb-3 mt-2 shrink-0");
    expect(layout).not.toContain("fixed inset-x-3 bottom-3");
    expect(styles).toContain("min-height: 56px");
    expect(styles).toContain("calc(8px + env(safe-area-inset-bottom))");
    expect(layout).toContain("overscroll-contain");
  });

  it("uses one task-oriented mobile shell with stable top-level destinations", () => {
    expect(layout).toContain("<MobileTopBar");
    expect(layout).toContain("<MobileBottomNav");
    expect(layout).not.toContain("Legacy mobile topbar");
    expect(layout).not.toContain("Legacy mobile navigation");
    for (const label of ["Home", "Sell", "Stock", "Customers"]) {
      expect(mobileChrome).toContain(`label: "${label}"`);
    }
    expect(mobileChrome).toContain("Open all app areas");
    expect(mobileChrome).toContain("Search products, bills, customers");
    expect(mobileChrome).toContain("Backup & sync");
  });
});
