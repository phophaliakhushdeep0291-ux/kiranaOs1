import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const billingPage = readFileSync("src/features/core/billing/pages/BillingPage.tsx", "utf8");
const billingQueries = readFileSync("src/features/core/billing/queries.ts", "utf8");
const offerApi = readFileSync("src/features/core/offers/api.ts", "utf8");
const billingTypes = readFileSync("src/features/core/billing/pages/billing-types.ts", "utf8");

/**
 * Top-level keys of the object literal passed to `call(` — order-independent.
 *
 * This used to be pinned as one long literal starting `writeBillingDraft({
 * activeBillId, sourceOrderId, …`, which meant inserting an unrelated field
 * (`tableId`) into the draft failed a test about coupon persistence while the
 * coupon still persisted perfectly well. What this test is actually for is that
 * `appliedOffer` is written to the draft and read back, so assert that and
 * nothing about the order it is written in.
 */
function objectArgumentKeys(source: string, call: string): string[] {
  const start = source.indexOf(`${call}({`);
  if (start === -1) throw new Error(`${call}({ … }) is no longer called in BillingPage — draft persistence is unverifiable.`);
  const segments: string[] = [];
  let current = "";
  let depth = 1;
  for (let i = source.indexOf("{", start) + 1; i < source.length; i += 1) {
    const character = source[i];
    if ("{[(".includes(character)) depth += 1;
    else if ("}])".includes(character)) depth -= 1;
    if (depth === 0) { segments.push(current); break; }
    if (depth === 1 && character === ",") { segments.push(current); current = ""; continue; }
    current += character;
  }
  return segments.map((segment) => segment.split(":")[0].trim()).filter(Boolean);
}

/** The dependency array of the effect that writes the draft. A field missing here persists stale. */
function effectDependenciesAround(source: string, call: string): string[] {
  const start = source.indexOf(`${call}({`);
  const deps = source.indexOf("}, [", start);
  const end = source.indexOf("]", deps);
  if (start === -1 || deps === -1 || end === -1) throw new Error(`The effect wrapping ${call} no longer ends in a dependency array.`);
  return source.slice(deps + "}, [".length, end).split(",").map((dependency) => dependency.trim()).filter(Boolean);
}

describe("atomic coupon billing client", () => {
  it("sends the server-verifiable offer reference with bill confirmation", () => {
    expect(billingPage).toContain("offerId: appliedOffer?.id");
    expect(billingPage).toContain("offerCode: appliedOffer?.code");
    expect(billingPage).toContain("offerDiscount: appliedOffer?.discount");
  });

  it("never performs a fire-and-forget standalone redemption", () => {
    expect(billingPage).not.toContain("redeemOffer(");
    expect(offerApi).not.toContain("/redeem");
    expect(billingQueries).toContain("if (data.offerId ||");
    expect(billingQueries).toContain("return createBill(data)");
  });

  it("persists the validated coupon across reloads and held-bill switching", () => {
    expect(billingTypes).toContain("appliedOffer?: AppliedOffer | null");
    expect(objectArgumentKeys(billingPage, "writeBillingDraft")).toContain("appliedOffer");
    expect(effectDependenciesAround(billingPage, "writeBillingDraft")).toContain("appliedOffer");
    expect(billingPage).toContain("setAppliedOffer(bill.appliedOffer ?? null)");
  });
});
