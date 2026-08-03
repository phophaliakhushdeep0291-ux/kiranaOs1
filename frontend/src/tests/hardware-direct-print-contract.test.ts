import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("direct hardware print safety contract", () => {
  const receiptSource = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/receipts/receipt-print.ts"), "utf8");
  const bridgeSource = fs.readFileSync(path.resolve(process.cwd(), "../hardware-bridge/src/server.mjs"), "utf8");

  it("sends one rendered receipt while the bridge owns physical copy iteration", () => {
    expect(receiptSource).toContain("buildReceiptHtml(snapshot, { ...renderOptions, copies: 1 })");
    expect(receiptSource).toContain("copies: renderOptions.copies ?? 1");
  });

  it("does not auto-print a second path after an ambiguous direct-print failure", () => {
    expect(receiptSource).toContain("writeReceiptWindow(popup, snapshot, { ...options, autoPrint: false })");
    expect(receiptSource).toContain("avoid a duplicate receipt");
    expect(receiptSource).toContain("Retry same print job");
    expect(receiptSource).toContain("writeUncertainDirectPrintFallback(popup, snapshot, options, submitSameJob)");
  });

  it("pulses the drawer once for a multi-copy job", () => {
    expect(bridgeSource).toContain("cashDrawer: cashDrawer && completedCopies === 0");
  });
});
