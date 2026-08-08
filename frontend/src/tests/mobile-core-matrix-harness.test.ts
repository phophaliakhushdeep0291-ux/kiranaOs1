import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync("scripts/capture-mobile-core-matrix-v1.mjs", "utf8");

describe("mobile core QA matrix harness", () => {
  it("covers every required core flow at the complete viewport matrix", () => {
    for (const qaId of [
      "MQA-BILL-01", "MQA-PROD-01", "MQA-CUST-01", "MQA-INV-01",
      "MQA-PUR-01", "MQA-RPT-01", "MQA-SET-01", "MQA-SYNC-01",
    ]) expect(source).toContain(qaId);
    for (const viewport of ["[375, 667]", "[390, 844]", "[430, 932]", "[768, 1024]"]) {
      expect(source).toContain(viewport);
    }
  });

  it("fails on route bounce, overflow, desktop chrome, loading stalls, or runtime errors", () => {
    expect(source).toContain("redirected from");
    expect(source).toContain("horizontal overflow");
    expect(source).toContain("desktopAsideVisible");
    expect(source).toContain("remained in a loading state");
    expect(source).toContain("runtime errors");
  });

  it("retains screenshots and machine-readable measurements and enforces 44px targets", () => {
    expect(source).toContain("Page.captureScreenshot");
    expect(source).toContain('"report.json"');
    expect(source).toContain("control.width < 44 || control.height < 44");
    expect(source).toContain("undersized.length === 0");
  });
});
