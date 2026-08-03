import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("retail UPI provider checkout contract", () => {
  const clientSource = fs.readFileSync(path.resolve(process.cwd(), "src/features/core/billing/retail-payment.ts"), "utf8");
  const serverSource = fs.readFileSync(path.resolve(process.cwd(), "../backend/src/modules/payment-provider/retailPayment.validation.js"), "utf8");

  it("shows only UPI instruments in the provider checkout", () => {
    expect(clientSource).toContain('instruments: [{ method: "upi" }]');
    expect(clientSource).toContain('sequence: ["block.upi_only"]');
    expect(clientSource).toContain("show_default_blocks: false");
  });

  it("independently rejects non-UPI captured payments on the server", () => {
    expect(serverSource).toContain('String(payment?.method || "").toLowerCase() === "upi"');
    expect(serverSource).toContain('payment?.captured === true');
  });
});
