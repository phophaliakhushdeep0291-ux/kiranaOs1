import { describe, it, expect, beforeEach } from "vitest";

// The test env is node (no DOM); provide a tiny in-memory sessionStorage the module can use.
const store = new Map<string, string>();
(globalThis as { sessionStorage?: unknown }).sessionStorage = {
  getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
  setItem: (k: string, v: string) => { store.set(k, String(v)); },
  removeItem: (k: string) => { store.delete(k); },
  clear: () => { store.clear(); },
};

import { stashPostLoginRedirect, consumePostLoginRedirect } from "@/features/core/auth/post-login-redirect";

const KEY = "kirana:post-login-redirect:v1";

describe("post-login redirect stash", () => {
  beforeEach(() => store.clear());

  it("round-trips an intended target and clears it after one read", () => {
    stashPostLoginRedirect("/import-order#o=abc");
    expect(consumePostLoginRedirect()).toBe("/import-order#o=abc");
    expect(consumePostLoginRedirect()).toBeNull(); // consumed exactly once
  });

  it("never stashes the auth pages themselves", () => {
    stashPostLoginRedirect("/login?next=x");
    stashPostLoginRedirect("/register");
    stashPostLoginRedirect("");
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it("ignores an expired stash (older than the TTL) so it can't hijack a later login", () => {
    store.set(KEY, JSON.stringify({ target: "/dashboard", ts: Date.now() - 10 * 60_000 }));
    expect(consumePostLoginRedirect()).toBeNull();
  });

  it("returns a fresh stash that is within the TTL", () => {
    store.set(KEY, JSON.stringify({ target: "/inventory", ts: Date.now() - 1_000 }));
    expect(consumePostLoginRedirect()).toBe("/inventory");
  });

  it("returns null when nothing is stashed or the value is malformed", () => {
    expect(consumePostLoginRedirect()).toBeNull();
    store.set(KEY, "not-json");
    expect(consumePostLoginRedirect()).toBeNull();
  });
});
