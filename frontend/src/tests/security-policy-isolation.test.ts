import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SECURITY_POLICY, getSecurityPolicySync, loadSecurityPolicy, setSecurityPolicyCache, sessionTimeoutMs } from "@/features/core/settings/security-policy";

const state = vi.hoisted(() => ({ instance: "session-a", read: vi.fn() }));
vi.mock("@/lib/storage/auth-storage", () => ({ authSessionInstance: () => state.instance }));
vi.mock("@/lib/offline/db", () => ({ offlineDB: { getSetting: state.read } }));

beforeEach(() => {
  state.instance = "session-a";
  state.read.mockReset();
  vi.stubGlobal("window", { dispatchEvent: vi.fn() });
  setSecurityPolicyCache(null);
});
afterEach(() => vi.unstubAllGlobals());

describe("security settings cache is not an authentication bypass", () => {
  it("does not use another account/session's weaker cached rules", () => {
    setSecurityPolicyCache({ requireLoginOnStart: false, sessionTimeout: "1 hour" });
    expect(getSecurityPolicySync().requireLoginOnStart).toBe(false);
    state.instance = "session-b";
    expect(getSecurityPolicySync()).toEqual(DEFAULT_SECURITY_POLICY);
  });
  it("falls back to protective defaults on database failure", async () => {
    setSecurityPolicyCache({ requireLoginOnStart: false, sessionTimeout: "1 hour" });
    state.read.mockRejectedValue(new Error("Database unavailable"));
    expect(await loadSecurityPolicy()).toEqual(DEFAULT_SECURITY_POLICY);
    expect(getSecurityPolicySync()).toEqual(DEFAULT_SECURITY_POLICY);
  });
  it("does not apply a late read to a different account", async () => {
    let finish!: (prefs: unknown) => void;
    state.read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const previous = loadSecurityPolicy();
    state.instance = "session-b";
    setSecurityPolicyCache({ sessionTimeout: "5 minutes" });
    finish({ security: { requireLoginOnStart: false, sessionTimeout: "1 hour" } });
    expect(await previous).toEqual(DEFAULT_SECURITY_POLICY);
    expect(getSecurityPolicySync().sessionTimeout).toBe("5 minutes");
    expect(getSecurityPolicySync().requireLoginOnStart).toBe(true);
  });
  it("does not let corrupt values silently disable lock rules", () => {
    setSecurityPolicyCache({ requireLoginOnStart: null, sessionTimeout: "banana", autoLock: 0, actions: { exportData: { on: null, approver: "anyone" } } } as never);
    expect(getSecurityPolicySync().requireLoginOnStart).toBe(true);
    expect(getSecurityPolicySync().autoLock).toBe(true);
    expect(sessionTimeoutMs()).toBe(15 * 60_000);
    expect(getSecurityPolicySync().actions.exportData).toEqual({ on: true, approver: "owner" });
    expect(sessionTimeoutMs({ ...DEFAULT_SECURITY_POLICY, sessionTimeout: "toString" })).toBe(15 * 60_000);
  });
  it("cannot roll back a newer settings decision with a delayed read", async () => {
    let finish!: (prefs: unknown) => void;
    state.read.mockReturnValue(new Promise((resolve) => { finish = resolve; }));
    const pending = loadSecurityPolicy();
    setSecurityPolicyCache({ requireLoginOnStart: true, sessionTimeout: "5 minutes" });
    finish({ security: { requireLoginOnStart: false, sessionTimeout: "1 hour" } });
    expect((await pending).requireLoginOnStart).toBe(true);
    expect(getSecurityPolicySync().sessionTimeout).toBe("5 minutes");
  });
});
