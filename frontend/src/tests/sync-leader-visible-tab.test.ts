import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  claimBackgroundLeadership,
  isBackgroundLeader,
  shouldRunScheduledNetworkWork,
} from "@/lib/browser/multiTabCoordinator";

// Two tabs of one browser profile: localStorage is shared, sessionStorage (which
// holds the tab id) and visibility belong to each tab.
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key) => map.get(key) ?? null,
    key: (index) => [...map.keys()][index] ?? null,
    removeItem: (key) => void map.delete(key),
    setItem: (key, value) => void map.set(key, String(value)),
  };
}

interface Tab {
  session: Storage;
  visibility: DocumentVisibilityState;
}

const shared = memoryStorage();
const document = { visibilityState: "visible" as DocumentVisibilityState };

function inTab<T>(tab: Tab, work: () => T): T {
  vi.stubGlobal("sessionStorage", tab.session);
  document.visibilityState = tab.visibility;
  return work();
}

function newTab(visibility: DocumentVisibilityState): Tab {
  return { session: memoryStorage(), visibility };
}

describe("scheduled sync leadership across tabs", () => {
  beforeEach(() => {
    shared.clear();
    vi.stubGlobal("window", {});
    vi.stubGlobal("document", document);
    vi.stubGlobal("localStorage", shared);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.useRealTimers();
  });

  it("hands the lease to the visible tab when the leader is switched away from", () => {
    const first = newTab("visible");
    const second = newTab("visible");

    expect(inTab(first, claimBackgroundLeadership)).toBe(true);
    // A second visible window does not steal from a visible leader.
    expect(inTab(second, claimBackgroundLeadership)).toBe(false);

    // The shopkeeper switches tabs. The old tab's heartbeat keeps running while
    // hidden, which is what used to hold the lease forever.
    first.visibility = "hidden";
    inTab(first, () => isBackgroundLeader() && claimBackgroundLeadership());
    expect(inTab(first, shouldRunScheduledNetworkWork)).toBe(false);

    // Before the fix this was false too, so no tab synced at all.
    expect(inTab(second, shouldRunScheduledNetworkWork)).toBe(true);

    // And the hidden tab's next heartbeat does not take it back.
    expect(inTab(first, isBackgroundLeader)).toBe(false);
    expect(inTab(second, isBackgroundLeader)).toBe(true);
  });

  it("does not let a hidden tab take the lease from a visible one", () => {
    const visible = newTab("visible");
    const hidden = newTab("hidden");

    expect(inTab(visible, claimBackgroundLeadership)).toBe(true);
    expect(inTab(hidden, claimBackgroundLeadership)).toBe(false);
    expect(inTab(visible, shouldRunScheduledNetworkWork)).toBe(true);
  });

  it("still waits out the lease of a leader recorded before visibility was tracked", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-26T10:00:00Z"));
    shared.setItem("kirana.background.leader", JSON.stringify({ tabId: "tab_legacy", updatedAt: Date.now() }));
    const tab = newTab("visible");

    expect(inTab(tab, shouldRunScheduledNetworkWork)).toBe(false);
    vi.setSystemTime(new Date("2026-09-26T10:00:21Z"));
    expect(inTab(tab, shouldRunScheduledNetworkWork)).toBe(true);
  });
});
