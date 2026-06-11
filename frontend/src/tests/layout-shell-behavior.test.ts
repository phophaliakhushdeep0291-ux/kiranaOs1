import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("desktop app shell behavior", () => {
  it("keeps the sidebar fixed while the page content scrolls", () => {
    // Desktop shell locks its own height so only the main region scrolls.
    expect(layout).toContain("lg:h-screen lg:overflow-hidden");
    // Sidebar is pinned to the viewport, content is offset by its (variable) width.
    expect(layout).toContain("fixed inset-y-0 left-0");
    expect(layout).toContain("lg:ml-[var(--app-sidebar-width)]");
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
    expect(layout).toContain("will-change-[width]");
    expect(layout).toContain("Resize sidebar");
    // Collapse: dedicated collapse/expand controls backed by a persisted flag.
    expect(layout).toContain("setCollapsed");
    expect(layout).toContain("Collapse sidebar");
    expect(layout).toContain("Expand sidebar");
  });
});
