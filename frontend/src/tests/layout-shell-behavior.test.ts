import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const layout = readFileSync("src/components/layout/Layout.tsx", "utf8");

describe("desktop app shell behavior", () => {
  it("keeps the sidebar fixed while the page content scrolls", () => {
    expect(layout).toContain("lg:h-screen lg:overflow-hidden");
    expect(layout).toContain("fixed inset-y-0 left-0");
    expect(layout).toContain("lg:ml-[var(--app-sidebar-width)]");
    expect(layout).toContain('id="main-content" className="min-w-0 flex-1 overflow-auto"');
  });

  it("lets desktop users resize and collapse the sidebar", () => {
    expect(layout).toContain("SIDEBAR_WIDTH_STORAGE_KEY");
    expect(layout).toContain("handleSidebarResize");
    expect(layout).toContain("requestAnimationFrame");
    expect(layout).toContain("shellRef.current?.style.setProperty");
    expect(layout).toContain("transition-none");
    expect(layout).toContain("will-change-[width]");
    expect(layout).toContain("Resize sidebar");
    expect(layout).toContain("PanelLeftClose");
    expect(layout).toContain("PanelLeftOpen");
  });
});
