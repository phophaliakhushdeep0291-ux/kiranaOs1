import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearCounterDrafts } from "@/lib/counter-draft";
import { saveAuthSession, clearAuthSession, type AuthSession } from "@/lib/storage/auth-storage";
import { assistantConversationScope, getAssistantConversation, updateAssistantConversation, ASSISTANT_MEMORY_MAX_AGE_MS } from "@/features/core/assistant/conversation-memory";
import type { AgentTurn } from "@/features/core/assistant/agent-client";

function storage() {
  const rows = new Map<string, string>();
  return { get length() { return rows.size; }, key: (index: number) => [...rows.keys()][index] ?? null,
    getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => rows.set(key, value),
    removeItem: (key: string) => rows.delete(key), clear: () => rows.clear() };
}
const session = { accessToken: "test-token", refreshToken: "login-one.secret-one", user: { id: "owner-one", shopId: "shop-one", role: "owner" }, shop: { id: "shop-one" } } as AuthSession;
const proposal = { turnId: "turn-one", planId: "plan-one", reply: "Review rice", plan: [{ ref: "1", tool: "create_product", risk: "owner_pin", summary: "Create rice at 64.5 per kg" }], requiresConfirmation: true, requiresOwnerPin: true, trace: [], stoppedBecause: "completed", provider: { name: "fixture", model: "fixture", toolsOffered: 1 } } as AgentTurn;
const currentStore = () => getAssistantConversation(assistantConversationScope("shop"));
function remember() {
  const store = currentStore();
  updateAssistantConversation(store, current => ({ ...current, messages: [
    { role: "user", content: "Create rice at 64.5 per kg" },
    { role: "assistant", content: "What tax rate?" },
  ], draft: "5 percent", pending: proposal, planState: { status: "pin", wrong: false } }));
  return store;
}

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-10-12T06:00:00Z"));
  vi.stubGlobal("window", { localStorage: storage(), sessionStorage: storage() });
  clearCounterDrafts(); saveAuthSession(session);
});
afterEach(() => { clearCounterDrafts(); vi.unstubAllGlobals(); vi.useRealTimers(); });

describe("assistant conversation continuity", () => {
  it("restores clarification, draft and pending proposal without browser-storage writes", () => {
    const before = window.localStorage.getItem(window.localStorage.key(0)!);
    const store = remember();
    expect(currentStore()).toBe(store);
    expect(currentStore().getSnapshot().value).toMatchObject({ draft: "5 percent", pending: proposal, planState: { status: "pin" } });
    expect(currentStore().getSnapshot().value.messages).toHaveLength(2);
    expect(window.localStorage.length).toBe(1);
    expect(window.localStorage.getItem(window.localStorage.key(0)!)).toBe(before);
    expect(window.sessionStorage.length).toBe(0);
    expect(currentStore().getSnapshot().value).not.toHaveProperty("pin");
  });

  it("survives token rotation within the same login", () => {
    const store = remember(); saveAuthSession({ accessToken: "rotated", refreshToken: "login-one.rotated-secret" });
    expect(currentStore()).toBe(store);
    expect(currentStore().getSnapshot().value.pending?.planId).toBe("plan-one");
  });

  it.each(["logout", "new-login", "other-shop", "other-user"])("clears old work after %s and ignores its late completion", change => {
    const old = remember();
    if (change === "logout") clearAuthSession();
    else if (change === "new-login") saveAuthSession({ refreshToken: "new-login.secret" });
    else if (change === "other-shop") saveAuthSession({ shop: { id: "shop-two" } as AuthSession["shop"] });
    else saveAuthSession({ user: { ...session.user!, id: "user-two" } });
    updateAssistantConversation(old, current => ({ ...current, messages: [{ role: "assistant", content: "Private late result" }] }));
    expect(old.getSnapshot().value.messages).toEqual([]);
    expect(currentStore().getSnapshot().value.pending).toBeNull();
    expect(currentStore().getSnapshot().value.messages).toEqual([]);
  });

  it("does not give an owner's conversation to a staff role or a different UI context", () => {
    remember();
    const staffScope = assistantConversationScope("shop", { ...session, user: { ...session.user!, role: "staff" } });
    expect(getAssistantConversation(staffScope).getSnapshot().value.messages).toEqual([]);
    expect(getAssistantConversation(assistantConversationScope("billing")).getSnapshot().value.pending).toBeNull();
  });

  it("never shares unscoped billing or unauthenticated conversations", () => {
    const first = getAssistantConversation(null);
    updateAssistantConversation(first, current => ({ ...current, pending: proposal }));
    expect(getAssistantConversation(null).getSnapshot().value.pending).toBeNull();
    expect(assistantConversationScope("shop", {})).toBeNull();
  });

  it("expires inactive conversations and proposals before reopening", () => {
    remember(); vi.advanceTimersByTime(ASSISTANT_MEMORY_MAX_AGE_MS);
    expect(currentStore().getSnapshot().value).toMatchObject({ messages: [], pending: null, draft: "" });
  });

  it("does not reset an unresolved execution and allow a second confirmation", () => {
    const store = remember(); updateAssistantConversation(store, current => ({ ...current, planState: { status: "working" } }));
    vi.advanceTimersByTime(ASSISTANT_MEMORY_MAX_AGE_MS);
    expect(currentStore().getSnapshot().value.planState.status).toBe("working");
  });

  it("bounds a long conversation while preserving the latest follow-up", () => {
    const store = remember();
    updateAssistantConversation(store, current => ({ ...current, draft: "d".repeat(3000), messages: Array.from({ length: 60 }, (_, index) => ({ role: "user", content: `${index}:` + "x".repeat(5000) })) }));
    const saved = currentStore().getSnapshot().value;
    expect(saved.messages).toHaveLength(40);
    expect(saved.messages.at(-1)?.content.startsWith("59:")).toBe(true);
    expect(saved.messages.every(message => message.content.length <= 4000)).toBe(true);
    expect(saved.draft.length).toBe(2000);
  });
});
