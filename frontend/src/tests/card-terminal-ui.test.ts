import fs from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * The card/EDC terminal is unverified against real hardware — no vendor SDK,
 * credentials or device exist yet. What is pinned here is the discipline the
 * flow must keep whichever vendor is eventually wired in.
 */
describe("counter card terminal checkout", () => {
  const api = fs.readFileSync("src/features/core/billing/card-terminal.ts", "utf8");
  const dialog = fs.readFileSync("src/features/core/billing/pages/components/CardTerminalDialog.tsx", "utf8");
  const page = fs.readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
  const panel = fs.readFileSync("src/features/core/billing/pages/components/BillingPaymentPanel.tsx", "utf8");

  it("pushes a charge and polls the acquirer rather than trusting the terminal screen", () => {
    expect(api).toContain("/payment-provider/terminal/charges");
    expect(api).toContain("/status");
    expect(api).toContain("/cancel");
    expect(dialog).toContain("getCardTerminalChargeStatus");
    expect(dialog).toContain('next.status === "confirmed"');
    expect(dialog).toContain('t("billing.pay.cardTerminal.waitingHelp")');
  });

  it("reuses a client request id and blocks blind retries when the bank outcome is unknown", () => {
    expect(api).toContain("newCardTerminalRequestId");
    expect(api).toContain("requestId");
    expect(api).toContain('"uncertain"');
    expect(page).toContain("cardTerminalAttemptRef");
    expect(page).toContain("previous.requestId");
    expect(page).toContain('status !== "uncertain"');
    expect(dialog).toContain('status === "uncertain"');
    expect(dialog).toContain('t("billing.pay.cardTerminal.uncertainHelp")');
    expect(dialog).toContain('onClose("uncertain")');
  });

  it("requires an owner-audited provider reconciliation before uncertain money can enter a bill", () => {
    expect(api).toContain("reconcileCardTerminalCharge");
    expect(api).toContain("/reconcile");
    expect(dialog).toContain("OwnerPinModal");
    expect(dialog).toContain('reconcileOutcome === "charged"');
    expect(dialog).toContain("providerPaymentId.trim()");
    expect(dialog).toContain('t("billing.pay.cardTerminal.notCharged")');
    expect(dialog).toContain('t("billing.pay.cardTerminal.charged")');
  });

  it("settles an approved card charge into the bank tender, not the cash drawer", () => {
    // "bank" is where the acquirer actually credits the shop; inventing a new
    // payment mode would silently break reports, closing and the audit rules.
    expect(page).toContain("paymentMode === BillPaymentMode.bank ? Math.min(effectivePaidAmount, grandTotal) : 0");
    expect(page).toContain("paymentMode === BillPaymentMode.bank && cardPaymentApproved ? { retailPaymentIntentId: approvedCardPayment?.intentId }");
  });

  it("voids an approval the moment the bill it was taken for changes", () => {
    expect(page).toContain("approvedCardPayment.amountPaise === cardTenderPaise");
    expect(page).toContain("approvedCardPayment.locationId === getActiveLocationId()");
    expect(page).toContain("if (approvedCardPayment && !cardPaymentApproved) setApprovedCardPayment(null)");
  });

  it("keeps the charge action out of sight unless a terminal is actually configured", () => {
    expect(panel).toContain("cardTerminalConfigured && paymentMode === BillPaymentMode.bank");
    expect(page).toContain("cardTerminalReadiness.data?.configured ?? false");
  });

  it("tells the cashier plainly when the terminal is a simulator", () => {
    // A simulated terminal approves payments no bank authorised; if one is ever
    // running, the person taking money must be able to see it.
    expect(dialog).toContain("simulated ?");
    expect(dialog).toContain('t("billing.pay.cardTerminal.simulated")');
    expect(page).toContain("simulated={cardTerminalReadiness.data?.simulated ?? false}");
  });
});
