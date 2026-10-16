import { afterEach, describe, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
const mocks = vi.hoisted(() => ({ request: vi.fn(), hydrate: vi.fn() }));
vi.mock("@/lib/api/http", () => ({ apiRequest: mocks.request }));
vi.mock("@/lib/device-identity", () => ({ hydrateDeviceIdentity: mocks.hydrate, getDeviceMetadata: () => ({ deviceId: "test-device" }) }));
import { nativeLoginUrl, startNativeLogin, pollNativeLogin } from "@/features/core/auth/native-login";
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe("installed app sign-in handoff", () => {
  it("puts only the public request id in the trusted website fragment", () => {
    expect(nativeLoginUrl("a".repeat(43), "https://kirana-os1.vercel.app")).toBe(`https://kirana-os1.vercel.app/native-sign-in#${"a".repeat(43)}`);
    for (const site of ["http://example.com", "javascript:alert(1)", "https://user:pass@example.com", "https://example.com/redirect?url=other"]) expect(() => nativeLoginUrl("a".repeat(43), site)).toThrow();
    expect(() => nativeLoginUrl("../redirect", "https://example.com")).toThrow();
  });
  it("uses a fresh private 256-bit verifier, sends device metadata, and never uses browser authentication", async () => {
    vi.stubGlobal("crypto", webcrypto);
    mocks.request.mockResolvedValue({ requestId: "a".repeat(43), userCode: "12345678" });
    const signal = new AbortController().signal;
    const first = await startNativeLogin(signal);
    const second = await startNativeLogin(signal);
    expect(first.verifier).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(first.verifier).not.toBe(second.verifier);
    expect(mocks.hydrate).toHaveBeenCalledTimes(2);
    const options = mocks.request.mock.calls[0][1];
    expect(options).toMatchObject({ method: "POST", skipAuth: true, skipRefresh: true, cache: "no-store", signal });
    expect(JSON.parse(options.body)).toEqual({ verifier: first.verifier, device: { deviceId: "test-device" } });
    await pollNativeLogin({ requestId: first.requestId, verifier: first.verifier }, signal);
    expect(mocks.request.mock.lastCall?.[0]).toBe("/auth/native/poll");
    expect(mocks.request.mock.lastCall?.[1].signal).toBe(signal);
  });
});
