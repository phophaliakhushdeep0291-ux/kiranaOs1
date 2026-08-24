import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/capture-mobile-core-matrix-v1.mjs", "utf8");
const inventorySource = readFileSync("src/features/core/inventory/pages/InventoryPage.tsx", "utf8");

describe("mobile core QA matrix harness", () => {
  it("covers every required core flow at the complete viewport matrix", () => {
    for (const qaId of [
      "MQA-BILL-01", "MQA-PROD-01", "MQA-CUST-01", "MQA-INV-01",
      "MQA-PUR-01", "MQA-RPT-01", "MQA-SET-01", "MQA-SYNC-01",
      // The udhar khata is a first-tap screen, so it is a required flow here rather than
      // relying on the source-level guards in udhar-home.test.ts.
      "MQA-UDHAR-01",
    ]) expect(source).toContain(qaId);
    for (const viewport of ["[375, 667]", "[390, 844]", "[430, 932]", "[768, 1024]"]) {
      expect(source).toContain(viewport);
    }
  });

  it("fails on route bounce, overflow, desktop chrome, loading stalls, or runtime errors", () => {
    expect(source).toContain("redirected from");
    expect(source).toContain("horizontal overflow");
    expect(source).toContain("desktopSidebarVisible");
    expect(source).toContain("remained in a loading state");
    expect(source).toContain("runtime errors");
    expect(source).toContain('"?filter=udhar"');
    expect(source).toContain("lost the expected query");
    expect(source).toContain("technicalDetails");
  });

  it("proves the Udhar deep link selects the credit filter without a page reload", () => {
    expect(source).toContain("auditUdharSpaTransition");
    expect(source).toContain('history.pushState(null,"","/udhar")');
    expect(source).toContain('data-customer-filter="udhar"');
    expect(source).toContain('state.activeFilter === "udhar"');
    expect(source).toContain("statefulChecks");
  });

  it("retains screenshots and machine-readable measurements and enforces 44px targets", () => {
    expect(source).toContain("Page.captureScreenshot");
    expect(source).toContain('"report.json"');
    expect(source).toMatch(/control\s*=>\s*control\.width\s*<\s*44\s*\|\|\s*control\.height\s*<\s*44/);
    expect(source).toContain("undersized.length === 0");
  });

  it("fails the live matrix on core semantic accessibility regressions", () => {
    for (const rule of [
      "document-title", "html-lang", "main-landmark", "page-h1", "heading-order",
      "duplicate-id", "broken-aria-reference", "interactive-name", "form-label",
      "image-alt", "aria-hidden-focus",
    ]) expect(source).toContain(rule);
    expect(source).toContain("metrics.accessibility.issueCount === 0");
    expect(source).toContain("node_modules/axe-core/axe.min.js");
    expect(source).toContain('"wcag22aa"');
    expect(source).toContain("axe WCAG violations");
    expect(source).toContain("metrics.axe.violationCount === 0");
    expect(source).toContain("passRuleCount");
    expect(source).toContain("incompleteCount");
  });

  it("proves every core route is operable with visible, named keyboard focus", () => {
    expect(source).toContain("auditKeyboardRoute");
    expect(source).toContain('Input.dispatchKeyEvent');
    expect(source).toContain('node.matches(\":focus-visible\")');
    expect(source).toContain("keyboard focus entered hidden or inert content");
    expect(source).toContain("keyboard focus reached an unnamed control");
    expect(source).toContain("has no visible keyboard focus indicator");
    expect(source).toContain("keyboard traversal missed");
    expect(source).toContain("keyboardResults");
  });

  it("keeps the decorative inventory chart out of the tab order and names its summary", () => {
    expect(inventorySource).toContain("rootTabIndex={-1}");
    expect(inventorySource).toContain('role="img"');
    expect(inventorySource).toContain("inventory.page.locationOverview");
    expect(inventorySource).toContain("fmtMoney(stockStats.stockValue)");
  });

  it("reuses a valid QA browser session instead of exhausting auth registration limits", () => {
    expect(source).toContain("PROFILE_DIR");
    expect(source).toContain('manifest.webmanifest');
    expect(source).toContain('apiUrl+\"/auth/me\"');
    expect(source).toContain('apiUrl+\"/auth/refresh\"');
    expect(source).toContain('return \"reused\"');
    expect(source).toContain('return \"refreshed\"');
    expect(source).toContain('return \"logged-in\"');
    expect(source).toContain('localStorage.setItem(mobileKey,qaMobile)');
    expect(source).toContain('client.send(\"Browser.close\")');
  });
});
