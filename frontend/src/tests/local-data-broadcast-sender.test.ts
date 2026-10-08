import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * A BroadcastChannel delivers a message to every other channel object, and the
 * refresh bridge's listening channel lives in the posting tab as well. Before
 * messages carried their sender, a sale reached its own tab twice — directly,
 * then again as a "broadcast" about 25ms later — and every local-data listener
 * ran twice for it.
 */

vi.mock("@/lib/offline/context", () => ({
  getOfflineScope: () => ({ tenant_id: "shop", store_id: "shop", device_id: "dev" }),
  nowIso: () => new Date().toISOString(),
}));
vi.mock("@/lib/offline/db", () => ({ offlineDB: {} }));

import { emitLocalDataChanged, isFromThisTab, type LocalDataChangeMessage } from "@/lib/offline/instant-cache";

const posted: LocalDataChangeMessage[] = [];

describe("local-data broadcasts name their sender", () => {
  beforeEach(() => {
    posted.length = 0;
    vi.stubGlobal("window", new EventTarget());
    vi.stubGlobal("BroadcastChannel", class {
      postMessage(message: LocalDataChangeMessage) { posted.push(message); }
      close() {}
    });
  });

  afterEach(() => vi.unstubAllGlobals());

  it("lets this tab recognise its own change coming back", () => {
    emitLocalDataChanged({ type: "bill", action: "created" });
    expect(posted).toHaveLength(1);
    expect(isFromThisTab(posted[0])).toBe(true);
  });

  it("does not mistake another tab's change, or an unmarked one, for its own", () => {
    emitLocalDataChanged({ type: "bill", action: "created" });
    expect(isFromThisTab({ ...posted[0], sender: "tab_another" })).toBe(false);
    expect(isFromThisTab({ source: "kirana-local-data", emittedAt: 0 })).toBe(false);
  });
});
