import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

class Script extends EventTarget {
  src = "";
  async = false;
  dataset: Record<string, string> = {};
  removed = false;
  remove() { this.removed = true; }
}
let scripts: Script[];
let browser: { Razorpay?: unknown };
let load: typeof import("../lib/razorpay-checkout-loader").loadRazorpayCheckout;
beforeEach(async () => {
  vi.resetModules(); vi.useFakeTimers(); scripts = []; browser = {};
  vi.stubGlobal("window", browser);
  vi.stubGlobal("document", {
    querySelector: () => scripts.find((script) => !script.removed) ?? null,
    createElement: () => new Script(),
    head: { appendChild: (script: Script) => scripts.push(script) },
  });
  ({ loadRazorpayCheckout: load } = await import("../lib/razorpay-checkout-loader"));
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

describe("shared payment checkout loader", () => {
  it("shares concurrent requests and validates the loaded constructor", async () => {
    const first = load(); expect(load()).toBe(first); expect(scripts).toHaveLength(1);
    browser.Razorpay = function Checkout() {}; scripts[0].dispatchEvent(new Event("load"));
    await first; await load(); expect(scripts).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("retries a failed download without refreshing the page", async () => {
    const rejected = expect(load()).rejects.toThrow("Unable to load");
    scripts[0].dispatchEvent(new Event("error")); await rejected;
    expect(scripts[0].removed).toBe(true);
    const retry = load(); expect(scripts).toHaveLength(2);
    browser.Razorpay = function Checkout() {}; scripts[1].dispatchEvent(new Event("load")); await retry;
    expect(vi.getTimerCount()).toBe(0);
  });
  it("bounds stalled downloads and ignores late events from removed scripts", async () => {
    const rejected = expect(load()).rejects.toThrow("too long");
    await vi.advanceTimersByTimeAsync(15_000); await rejected;
    const retry = load(); scripts[0].dispatchEvent(new Event("load"));
    expect(scripts[1].dataset.razorpayState).toBe("loading");
    browser.Razorpay = function Checkout() {}; scripts[1].dispatchEvent(new Event("load")); await retry;
  });
  it("does not treat a load event without a constructor as success", async () => {
    const rejected = expect(load()).rejects.toThrow("did not initialize");
    scripts[0].dispatchEvent(new Event("load")); await rejected;
    expect(scripts[0].removed).toBe(true);
  });
  it("replaces an unusable previously loaded script", async () => {
    const first = load(); browser.Razorpay = function Checkout() {};
    scripts[0].dispatchEvent(new Event("load")); await first;
    delete browser.Razorpay; const retry = load(); expect(scripts).toHaveLength(2);
    browser.Razorpay = function Checkout() {}; scripts[1].dispatchEvent(new Event("load")); await retry;
  });
  it("adopts an existing in-flight provider script without duplicating it", async () => {
    const existing = new Script(); existing.src = "https://checkout.razorpay.com/v1/checkout.js"; scripts.push(existing);
    const ready = load(); expect(scripts).toHaveLength(1);
    browser.Razorpay = function Checkout() {}; existing.dispatchEvent(new Event("load")); await ready;
  });
  it("rejects non-browser invocation", async () => {
    vi.stubGlobal("window", undefined); await expect(load()).rejects.toThrow("only in the browser");
  });
});
