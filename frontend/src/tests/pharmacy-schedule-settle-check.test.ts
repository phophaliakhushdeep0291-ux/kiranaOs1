import { readFileSync } from "node:fs";
import { beforeEach, describe, expect, it } from "vitest";
import { unslippedScheduleLines } from "@/features/verticals/pharmacy/prescriptions/billing-schedule-check";
import { firstSettleWarning, resetSettleChecks } from "@/features/core/billing/settle-checks";
import type { CartItem } from "@/features/core/billing/pages/billing-types";

/**
 * Handing over a Schedule H medicine on nothing.
 *
 * The server refuses such a bill (`sale-guards.js`), and billing offers the
 * prescription control the moment a restricted line is scanned. Neither stops
 * the counter, because the till is offline-first: the bill commits locally, the
 * shop is told "saved safely", and the server's refusal arrives long after the
 * strip has left the shop.
 *
 * Selling Alprax — Schedule H1, the strictest class — with no slip attached was
 * exactly that: a saved bill, a dispensed medicine, and a CREATE_BILL sitting in
 * the outbox waiting to be rejected by a rule nobody at the counter was shown.
 *
 * This asks the same question while the customer is still standing there. It
 * warns rather than refuses: a chemist may be holding the paper slip, and a till
 * that refuses outright is a till that gets worked around.
 */

const line = (name: string, drugSchedule?: string): CartItem => ({
  product: { id: `p-${name}`, name, ...(drugSchedule ? { drugSchedule } : {}) },
  quantity: 1,
  rate: 45,
  unit: "piece",
}) as CartItem;

beforeEach(() => resetSettleChecks());

describe("a restricted line with no slip attached", () => {
  it("warns, naming the medicine and its schedule", async () => {
    const warning = await unslippedScheduleLines({ billId: "b1", cart: [line("Alprax 0.5 mg", "h1")] });
    expect(warning).not.toBeNull();
    expect(warning?.title.vars).toMatchObject({ schedule: "H1" });
    expect(String(warning?.body.vars?.items)).toContain("Alprax 0.5 mg");
  });

  it("reports the strictest schedule on the bill", async () => {
    // H1 outranks X, which outranks H — it is the one with its own bound
    // register and the longest retention.
    const warning = await unslippedScheduleLines({
      billId: "b1",
      cart: [line("Amoxicillin", "h"), line("Alprax", "h1"), line("Morphine", "x")],
    });
    expect(warning?.title.vars).toMatchObject({ schedule: "H1" });
  });

  it("says nothing once a prescription is attached", async () => {
    // Whatever the pharmacy's own control is holding satisfies the server guard
    // too, so it satisfies this.
    const warning = await unslippedScheduleLines({
      billId: "b1",
      cart: [line("Alprax", "h1")],
      slotValues: { "pharmacy/prescription": { id: "rx-1" } },
    });
    expect(warning).toBeNull();
  });

  it("leaves an ordinary basket alone", async () => {
    // Every sale in a shop that has not classified its catalogue, and every OTC
    // sale in one that has.
    expect(await unslippedScheduleLines({ billId: "b1", cart: [line("Crocin", "otc")] })).toBeNull();
    expect(await unslippedScheduleLines({ billId: "b1", cart: [line("Shampoo")] })).toBeNull();
    expect(await unslippedScheduleLines({ billId: "b1", cart: [] })).toBeNull();
  });

  it("is not fooled by casing or padding on the flag", async () => {
    expect(await unslippedScheduleLines({ billId: "b1", cart: [line("Alprax", " H1 ")] })).not.toBeNull();
  });
});

describe("how it reaches the counter", () => {
  it("runs through the shared registry billing already consults", async () => {
    const { registerSettleCheck } = await import("@/features/core/billing/settle-checks");
    registerSettleCheck({ id: "pharmacy/schedule-slip", run: unslippedScheduleLines });
    const warning = await firstSettleWarning({ billId: "b1", cart: [line("Alprax", "h1")] });
    expect(warning?.title.key).toBe("shopType.pharmacy.settle.noPrescriptionTitle");
  });

  it("is declared by the pharmacy pack and wired to its module", () => {
    const pack = readFileSync("src/features/verticals/pharmacy/pack.ts", "utf8");
    const slots = readFileSync("src/app/vertical-slots.ts", "utf8");
    expect(pack).toContain('"pharmacy/schedule-slip"');
    expect(slots).toContain('"pharmacy/schedule-slip": () => import("@/features/verticals/pharmacy/prescriptions/billing-schedule-check")');
  });

  it("gets the trade's own control values from billing", () => {
    // The question is not "is there a Schedule H line?" but "is there one with
    // no prescription attached?", and only the pharmacy's slot knows what
    // attached looks like.
    const page = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
    expect(page).toContain("slotValues: billingSlotValues");
  });
});
