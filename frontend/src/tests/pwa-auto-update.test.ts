import { describe, expect, it } from "vitest";
import { counterIsBusy, __autoUpdateInternals, type CounterState } from "@/lib/pwa/auto-update";

/**
 * When it is safe to swap the build under a running till.
 *
 * The service worker installs a new build and waits, because activating it drops
 * the previous build's chunks and a lazy import a second later can 404. The app
 * asks first, with a toast — but nobody has to answer it, so a tab open since
 * before a deploy serves the old build indefinitely. That is how a fix that was
 * written, tested, merged and deployed still was not on the shopkeeper's screen,
 * and the honest report was "it still shows so many devices".
 *
 * Applying the update automatically closes that gap, and every risk of doing so
 * lives in this one predicate. It is deliberately pessimistic: an uncertain
 * answer is "busy", because another fifteen seconds costs nothing and a wrong
 * guess costs a bill.
 */
const quiet: CounterState = { cartItemCount: 0, pathname: "/dashboard", modalOpen: false };

describe("is the counter busy", () => {
  it("is quiet on an ordinary screen with an empty cart", () => {
    expect(counterIsBusy(quiet)).toBe(false);
  });

  it("is busy with a half-built bill, wherever the shopkeeper is standing", () => {
    expect(counterIsBusy({ ...quiet, cartItemCount: 2 })).toBe(true);
    expect(counterIsBusy({ ...quiet, cartItemCount: 2, pathname: "/reports" })).toBe(true);
  });

  it("is busy on the till even when the cart is empty", () => {
    // A barcode scan is one beep away from starting a sale.
    expect(counterIsBusy({ ...quiet, pathname: "/billing" })).toBe(true);
  });

  it("is busy while a dialog is open", () => {
    // A payment, an owner PIN, a confirm — all decisions in progress.
    expect(counterIsBusy({ ...quiet, modalOpen: true })).toBe(true);
  });

  it("treats an unreadable draft as busy rather than assuming an empty cart", () => {
    // The one that matters most. If the draft cannot be read, we cannot claim it
    // is empty — and claiming it reloads the app over a bill in progress.
    expect(counterIsBusy({ ...quiet, cartItemCount: null })).toBe(true);
  });

  it("waits long enough that a pause between customers is not idleness", () => {
    // Short enough and a shopkeeper reaching for a bag looks idle.
    expect(__autoUpdateInternals.IDLE_BEFORE_UPDATE_MS).toBeGreaterThanOrEqual(30_000);
    expect(__autoUpdateInternals.SAFETY_POLL_MS).toBeLessThanOrEqual(__autoUpdateInternals.IDLE_BEFORE_UPDATE_MS);
  });
});
