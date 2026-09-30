import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "@/lib/api/http";
import type { CartItem } from "@/features/core/billing/pages/billing-types";

/**
 * A handset leaving with nobody having said which one it was.
 *
 * The server takes a bill with no serial on it — it has to: the box may not
 * have been scanned, the till may be offline, the shop's plan may not include
 * the register. So the only place left to catch a forgotten serial is the
 * counter, and this is that question, asked while the phone is still there.
 *
 * It warns and lets a person decide, like the pharmacy and restaurant checks
 * beside it. What these pin is that it asks exactly when it should: about
 * serial-tracked products only, about the pieces still missing one, offline in
 * different words — and never about a charger.
 */

const state = vi.hoisted(() => ({
  settings: new Map<string, unknown>(),
  answer: (() => Promise.resolve([])) as (path: string) => Promise<unknown>,
  requests: [] as string[],
}));

vi.mock("@/lib/offline/db", () => ({
  offlineDB: {
    getSetting: async (key: string) => state.settings.get(key),
    setSetting: async (key: string, value: unknown) => { state.settings.set(key, value); },
  },
}));
vi.mock("@/lib/api/http", async (original) => ({
  ...(await original<typeof import("@/lib/api/http")>()),
  apiRequest: (path: string) => { state.requests.push(path); return state.answer(path); },
}));

import { unserialisedTrackedLines } from "@/features/verticals/electronics/units/billing-serial-check";
import { getUnitBillingOptions, trackedProductIds } from "@/features/verticals/electronics/units/api";
import { TRACKED_UNITS_SLOT } from "@/features/verticals/electronics/units/billing-selection";
import { firstSettleWarning, registerSettleCheck, resetSettleChecks } from "@/features/core/billing/settle-checks";

const line = (id: string, quantity = 1): CartItem => ({ product: { id, name: id === "phone" ? "Galaxy A16" : "Charger" }, quantity, rate: 100, unit: "piece" }) as CartItem;
const option = (productId: string, serials: string[] = []) => ({
  productId, registered: serials.length || 1, sellableCount: serials.length,
  units: serials.map((serialNumber) => ({ id: serialNumber, productId, serialNumber, canSell: true })),
});
const chosen = (...ids: string[]) => ({ [TRACKED_UNITS_SLOT]: ids.map((id) => ({ id, productId: "phone", label: id })) });
const electronics = { billId: "b1", businessType: "electronics", online: true };

beforeEach(() => {
  state.settings = new Map();
  state.requests = [];
  // The register knows the phone; nobody ever registered a charger.
  state.answer = async () => [option("phone", ["SN-1", "SN-2"])];
  resetSettleChecks();
});

describe("a serial-tracked product with no serial chosen", () => {
  it("asks, naming the product and how many pieces are going out unrecorded", async () => {
    const warning = await unserialisedTrackedLines({ ...electronics, cart: [line("phone", 2), line("charger")] });

    expect(warning?.title.key).toBe("shopType.electronics.settle.noSerialTitle");
    expect(warning?.body).toEqual({ key: "shopType.electronics.settle.noSerialBody", vars: { items: "Galaxy A16 × 2" } });
    expect(warning?.confirm.key).toBe("shopType.electronics.settle.noSerialConfirm");
  });

  it("counts only the pieces still missing one", async () => {
    const warning = await unserialisedTrackedLines({ ...electronics, cart: [line("phone", 2)], slotValues: chosen("SN-1") });
    expect(warning?.body.vars).toEqual({ items: "Galaxy A16 × 1" });
  });

  it("says nothing once every piece has its serial", async () => {
    expect(await unserialisedTrackedLines({ ...electronics, cart: [line("phone", 2)], slotValues: chosen("SN-1", "SN-2") })).toBeNull();
  });

  it("leaves a bill of chargers and covers alone", async () => {
    expect(await unserialisedTrackedLines({ ...electronics, cart: [line("charger", 3)] })).toBeNull();
    expect(await unserialisedTrackedLines({ ...electronics, cart: [] })).toBeNull();
  });
});

describe("offline", () => {
  it("says the serial cannot be recorded at all — even one that was ticked", async () => {
    // Billing attaches no serial to a queued bill, so a choice made on screen is
    // not going anywhere. The warning has to describe what will happen, not
    // what the ticks suggest.
    await getUnitBillingOptions(["phone", "charger"]);

    const warning = await unserialisedTrackedLines({ ...electronics, online: false, cart: [line("phone", 2)], slotValues: chosen("SN-1", "SN-2") });
    expect(warning?.title.key).toBe("shopType.electronics.settle.offlineTitle");
    expect(warning?.body).toEqual({ key: "shopType.electronics.settle.offlineBody", vars: { items: "Galaxy A16 × 2" } });
  });

  it("knows which products are tracked from what this device last learned", async () => {
    await getUnitBillingOptions(["phone", "charger"]);
    state.answer = async () => { throw new ApiClientError("Network request failed", 0); };

    const answer = await getUnitBillingOptions(["phone", "charger"]);
    // Which products, but no units: a serial cannot be reserved from memory.
    expect(answer).toEqual({ live: false, options: [{ productId: "phone", registered: 0, sellableCount: 0, units: [] }] });
  });

  it("has nothing to say about a product it has never been able to ask about", async () => {
    state.answer = async () => { throw new ApiClientError("Network request failed", 0); };
    // Thrown by the lookup, swallowed by the registry: a warning that cannot be
    // computed is not a reason to stop a shop taking money.
    registerSettleCheck({ id: "electronics/serial-check", run: unserialisedTrackedLines });
    expect(await firstSettleWarning({ ...electronics, online: false, cart: [line("phone")] })).toBeNull();
  });
});

describe("what it costs a sale", () => {
  it("is answered from memory once the bill's own control has asked the server", async () => {
    // The picker on the bill already fetched this cart. The check that runs as
    // the cashier presses Save must not hold the sale behind a second request.
    await getUnitBillingOptions(["phone", "charger"]);
    state.requests = [];

    expect(await trackedProductIds(["charger", "phone"])).toEqual({ tracked: new Set(["phone"]), live: true });
    expect(state.requests).toEqual([]);
  });

  it("asks the server only about a product this device has never asked about", async () => {
    await getUnitBillingOptions(["charger"]);
    state.requests = [];

    await trackedProductIds(["charger", "phone"]);
    expect(state.requests).toHaveLength(1);
    expect(state.requests[0]).toContain("/product-units/billing-options?productIds=");
  });

  it("is not run at all for a shop of another trade opened in the same session", async () => {
    // A registration lasts as long as the page. A kirana shop's bill must not
    // pay for a question about a register it does not have.
    expect(await unserialisedTrackedLines({ billId: "b1", businessType: "kirana", online: true, cart: [line("phone")] })).toBeNull();
    expect(state.requests).toEqual([]);
  });

  it("treats a plan without the serial register as a shop with nothing to choose", async () => {
    state.answer = async () => { throw new ApiClientError("Serial number tracking is not enabled for this shop", 403); };
    expect(await getUnitBillingOptions(["phone"])).toEqual({ options: [], live: true });
    expect(await unserialisedTrackedLines({ ...electronics, cart: [line("phone")] })).toBeNull();
  });

  it("does not hide a signed-out session behind remembered answers", async () => {
    await getUnitBillingOptions(["phone"]);
    state.answer = async () => { throw new ApiClientError("Session expired", 401); };
    await expect(getUnitBillingOptions(["phone"])).rejects.toMatchObject({ status: 401 });
  });
});
