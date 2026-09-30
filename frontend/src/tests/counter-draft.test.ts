import { afterEach, describe, expect, it, vi } from "vitest";
import { clearCounterDrafts, counterDraftScope, createCounterDraft } from "@/lib/counter-draft";
import { authSessionInstance, clearAuthSession, saveAuthSession } from "@/lib/storage/auth-storage";
import type { Shop, User } from "@/types/api";

const drafts = createCounterDraft(() => ({ open: false, codes: [] as string[], notes: "" }));
afterEach(() => { clearCounterDrafts(); vi.unstubAllGlobals(); });

describe("counter draft recovery", () => {
  it("restores form visibility and values after all page subscribers unmount", () => {
    const scope = counterDraftScope("session-a", "branch-a");
    const first = drafts.forScope(scope);
    const listener = vi.fn();
    const unsubscribe = first.subscribe(listener);
    first.update({ open: true, codes: ["SERIAL-01", "SERIAL-02"], notes: "Shelf two" });
    unsubscribe(); // SessionLockGate removes the entire page.
    const reopened = drafts.forScope(scope);
    expect(reopened.getSnapshot().value).toEqual({ open: true, codes: ["SERIAL-01", "SERIAL-02"], notes: "Shelf two" });
    reopened.update((value) => ({ ...value, codes: [...value.codes, "SERIAL-03"] }));
    expect(reopened.getSnapshot().value.codes).toHaveLength(3);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("isolates sessions, branches, forms, and unauthenticated pages", () => {
    drafts.forScope(counterDraftScope("session-a", "branch-a")).update({ notes: "Private" });
    for (const scope of [counterDraftScope("session-b", "branch-a"), counterDraftScope("session-a", "branch-b"), null]) {
      expect(drafts.forScope(scope).getSnapshot().value.notes).toBe("");
    }
    drafts.forScope(null).update({ notes: "Never share" });
    expect(drafts.forScope(null).getSnapshot().value.notes).toBe("");
    const otherForm = createCounterDraft(() => ({ notes: "" }));
    expect(otherForm.forScope(counterDraftScope("session-a", "branch-a")).getSnapshot().value.notes).toBe("");
    expect(counterDraftScope(null, "branch-a")).toBeNull();
  });

  it("keeps drafts during token rotation and clears them on a fresh sign-in", () => {
    const values = new Map<string, string>();
    vi.stubGlobal("window", { localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    } });
    saveAuthSession({
      user: { id: "user-a", shopId: "shop-a" } as User,
      shop: { id: "shop-a" } as Shop,
      refreshToken: "session-a.first-secret",
    });
    const scope = counterDraftScope(authSessionInstance(), "branch-a");
    const old = drafts.forScope(scope);
    old.update({ notes: "Keep during token refresh" });
    saveAuthSession({ refreshToken: "session-a.rotated-secret", accessToken: "rotated-access" });
    expect(counterDraftScope(authSessionInstance(), "branch-a")).toBe(scope);
    expect(old.getSnapshot().value.notes).toBe("Keep during token refresh");
    saveAuthSession({ refreshToken: "session-b.new-secret" });
    expect(old.getSnapshot().value.notes).toBe("");
    expect(drafts.forScope(counterDraftScope(authSessionInstance(), "branch-a")).getSnapshot().value.notes).toBe("");
  });

  it("discards on cancel and starts with fresh arrays", () => {
    const store = drafts.forScope("a");
    store.update({ open: true, codes: ["SERIAL-01"] });
    store.discard();
    expect(drafts.forScope("a").getSnapshot().value).toEqual({ open: false, codes: [], notes: "" });
  });

  it("blocks a second submission and edits across locking, then clears on success", async () => {
    const store = drafts.forScope("a");
    store.update({ open: true, codes: ["SERIAL-01"] });
    let finish!: (result: string) => void;
    const saving = store.submit(() => new Promise<string>((resolve) => { finish = resolve; }));
    const remounted = drafts.forScope("a");
    const duplicate = vi.fn();
    await expect(remounted.submit(duplicate)).rejects.toThrow();
    expect(duplicate).not.toHaveBeenCalled();
    remounted.update({ codes: ["SERIAL-02"] });
    remounted.discard();
    expect(remounted.getSnapshot()).toMatchObject({ value: { open: true, codes: ["SERIAL-01"], notes: "" }, pending: true });
    finish("saved");
    await expect(saving).resolves.toBe("saved");
    expect(remounted.getSnapshot()).toMatchObject({ value: { open: false, codes: [], notes: "" }, pending: false });
  });

  it("keeps the draft after a failed save so it can be corrected and retried", async () => {
    const store = drafts.forScope("a");
    store.update({ open: true, codes: ["DUPLICATE"] });
    await expect(store.submit(async () => { throw new Error("Already registered"); })).rejects.toThrow("Already registered");
    expect(store.getSnapshot().pending).toBe(false);
    expect(store.getSnapshot().value.codes).toEqual(["DUPLICATE"]);
    store.update({ codes: ["FIXED"] });
    await store.submit(async () => "ok");
    expect(store.getSnapshot().value.open).toBe(false);
  });

  it("sign-out clears retained references and late responses cannot erase a new draft", async () => {
    const old = drafts.forScope("a");
    old.update({ notes: "Customer note" });
    let finish!: () => void;
    const saving = old.submit(() => new Promise<void>((resolve) => { finish = resolve; }));
    clearAuthSession();
    expect(old.getSnapshot().value.notes).toBe("");
    old.update({ notes: "Stale update" });
    const next = drafts.forScope("a");
    next.update({ notes: "New entry" });
    finish();
    await saving;
    expect(old.getSnapshot().value.notes).toBe("");
    expect(next.getSnapshot().value.notes).toBe("New entry");
    await expect(old.submit(async () => "no")).rejects.toThrow();
  });
});

function storageFixture() {
  const values = new Map<string, string>();
  vi.stubGlobal("window", { localStorage: {
    get length() { return values.size; }, key: (index: number) => [...values.keys()][index],
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  } });
  return values;
}
const persisted = () => createCounterDraft(() => ({ notes: "", open: false }), {
  key: "test-entry", parse(value: unknown) {
    const row = value as { notes: string; open: boolean };
    if (typeof row?.notes !== "string" || typeof row?.open !== "boolean") throw Error("Invalid draft");
    return row;
  },
});
it("recovers after a new JS runtime, isolates location, and removes completed or cancelled drafts", async () => {
  const values = storageFixture();
  persisted().forScope("owner/location-a").update({ notes: "Saved on disk", open: true });
  const restarted = persisted();
  expect(restarted.forScope("owner/location-b").getSnapshot().value.notes).toBe("");
  const restored = restarted.forScope("owner/location-a");
  expect(restored.getSnapshot().value).toEqual({ notes: "Saved on disk", open: true });
  await restored.submit(async () => "saved");
  expect(values.size).toBe(0);
  restored.update({ notes: "Discard me" }); restored.discard();
  expect(values.size).toBe(0);
});
it("an interrupted save cannot be retried or edited after restart", async () => {
  storageFixture();
  const first = persisted().forScope("a"); first.update({ notes: "May already be saved", open: true });
  let finish!: () => void;
  const pending = first.submit(() => new Promise<void>(resolve => { finish = resolve; }));
  const recovered = persisted().forScope("a");
  expect(recovered.getSnapshot().recoveryRequired).toBe(true);
  const duplicate = vi.fn(); await expect(recovered.submit(duplicate)).rejects.toThrow();
  expect(duplicate).not.toHaveBeenCalled();
  recovered.update({ notes: "Changed" });
  expect(recovered.getSnapshot().value.notes).toBe("May already be saved");
  recovered.discard(); expect(recovered.getSnapshot().recoveryRequired).toBe(false);
  finish(); await pending;
});
it.each(["corrupt", "expired", "wrong-shape"])("ignores a %s durable record", (kind) => {
  const values = storageFixture(); persisted().forScope("a").update({ notes: "Old" });
  const [key, raw] = [...values][0]; const record = JSON.parse(raw);
  if (kind === "expired") record.savedAt = Date.now() - 8 * 86_400_000;
  if (kind === "wrong-shape") record.value.notes = 42;
  values.set(key, kind === "corrupt" ? "{" : JSON.stringify(record));
  expect(persisted().forScope("a").getSnapshot().value.notes).toBe("");
});
it("reports storage failure without losing edits, and sign-out removes lazy form records", () => {
  const values = storageFixture(); persisted().forScope("a").update({ notes: "Private" });
  values.set('artha:counter-draft:v1:unloaded-form', "private");
  clearCounterDrafts(); expect(values.size).toBe(0);
  window.localStorage.setItem = () => { throw Error("Quota full"); };
  const form = persisted().forScope("a"); form.update({ notes: "Still here" });
  expect(form.getSnapshot()).toMatchObject({ value: { notes: "Still here" }, storageFailed: true });
});
