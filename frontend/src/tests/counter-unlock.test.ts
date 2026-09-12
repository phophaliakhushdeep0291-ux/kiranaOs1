import { generateKeyPairSync, createHash, sign, webcrypto } from "node:crypto";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { verifyCounterPin } from "@/features/core/settings/counter-unlock";
import { enrolBiometric, verifyBiometric, isBiometricEnrolled, forgetBiometric } from "@/features/core/settings/biometric-unlock";
import { saveAuthSession, clearAuthStorage } from "@/lib/storage/auth-storage";
import { DEVICE_UNLOCK_KEY, LEGACY_DEVICE_UNLOCK_KEY } from "@/lib/storage/device-unlock-storage";
import { counterIdleDecision, counterStartupDecision, markCounterActive, markCounterSessionStarted } from "@/features/core/settings/counter-lock-policy";
import { DEFAULT_SECURITY_POLICY } from "@/features/core/settings/security-policy";

const mocks = vi.hoisted(() => ({ pin: vi.fn(), device: "test-device" }));
vi.mock("@/features/core/settings/api", () => ({ verifyOwnerPin: mocks.pin }));
vi.mock("@/lib/device-identity", () => ({ getPermanentDeviceId: () => mocks.device }));

function memoryStorage() {
  const values = new Map<string, string>();
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
    clear: () => values.clear(),
  };
}
const bytes = (value: Buffer | Uint8Array) => Uint8Array.from(value).buffer;
const b64 = (value: ArrayBuffer) => Buffer.from(value).toString("base64url");

function session(user = "owner-a", shop = "shop-a") {
  saveAuthSession({ accessToken: "access", refreshToken: "refresh", user: { id: user, shopId: shop, role: "owner", name: "QA Owner" } as never, shop: { id: shop } as never });
}

beforeEach(() => {
  const localStorage = memoryStorage();
  const sessionStorage = memoryStorage();
  vi.stubGlobal("window", { localStorage, sessionStorage, location: { hostname: "localhost", origin: "http://localhost:51977" }, PublicKeyCredential: { isUserVerifyingPlatformAuthenticatorAvailable: async () => true } });
  vi.stubGlobal("localStorage", localStorage);
  vi.stubGlobal("sessionStorage", sessionStorage);
  vi.stubGlobal("navigator", { onLine: true, credentials: { create: vi.fn(), get: vi.fn() } });
  vi.stubGlobal("crypto", webcrypto);
  mocks.pin.mockReset().mockResolvedValue({ valid: true });
  mocks.device = "test-device";
  session();
});
afterEach(() => vi.unstubAllGlobals());

describe("counter PIN requires positive authentication", () => {
  it("accepts only the positive server result", async () => {
    await expect(verifyCounterPin("2468")).resolves.toBeUndefined();
    expect(mocks.pin).toHaveBeenCalledWith("2468");
  });
  it("allows token rotation but rejects a new login to the same account", async () => {
    saveAuthSession({ refreshToken: "session-a.old-secret" });
    mocks.pin.mockImplementation(async () => { saveAuthSession({ refreshToken: "session-a.new-secret" }); return { valid: true }; });
    await expect(verifyCounterPin("2468")).resolves.toBeUndefined();
    mocks.pin.mockImplementation(async () => { saveAuthSession({ refreshToken: "session-b.secret" }); return { valid: true }; });
    await expect(verifyCounterPin("2468")).rejects.toThrow("session changed");
  });
  it.each([{ valid: false }, {}, null, { valid: "true" }])("rejects malformed/negative success %j", async (response) => {
    mocks.pin.mockResolvedValue(response);
    await expect(verifyCounterPin("2468")).rejects.toThrow("did not verify");
  });
  it.each([new TypeError("Failed to fetch"), Object.assign(new Error("offline"), { status: 0 }), Object.assign(new Error("Wrong PIN"), { status: 403 }), Object.assign(new Error("timeout"), { status: 504 })])("does not turn a failure into unlock: %s", async (error) => {
    mocks.pin.mockRejectedValue(error);
    await expect(verifyCounterPin("2468")).rejects.toBe(error);
  });
  it("does not bypass the PIN when the browser is offline", async () => {
    vi.stubGlobal("navigator", { onLine: false });
    await expect(verifyCounterPin("2468")).rejects.toThrow("needs a connection");
    expect(mocks.pin).not.toHaveBeenCalled();
  });
  it.each(["", "abcde", "12345", "123", "１２３４"])("rejects invalid PIN %s", async (pin) => {
    await expect(verifyCounterPin(pin)).rejects.toThrow("4-digit");
    expect(mocks.pin).not.toHaveBeenCalled();
  });
  it("rejects a positive result after a shop change or logout", async () => {
    mocks.pin.mockImplementation(async () => { session("owner-a", "shop-b"); return { valid: true }; });
    await expect(verifyCounterPin("2468")).rejects.toThrow("session changed");
    mocks.pin.mockImplementation(async () => { clearAuthStorage(); return { valid: true }; });
    await expect(verifyCounterPin("2468")).rejects.toThrow("session changed");
  });
});

type Mutation = "challenge" | "origin" | "crossOrigin" | "type" | "rp" | "presence" | "verification" | "signature" | "credential" | "user" | "counter" | "logout";

function authenticator(algorithm: -7 | -257 = -7) {
  const pair = algorithm === -7
    ? generateKeyPairSync("ec", { namedCurve: "prime256v1" })
    : generateKeyPairSync("rsa", { modulusLength: 2048 });
  const id = bytes(Buffer.from("test-credential-handle"));
  let userHandle: ArrayBuffer;
  let mutation: Mutation | undefined;
  let counter = 0;
  const authData = (enrol = false) => {
    const data = Buffer.alloc(enrol ? 55 + id.byteLength : 37);
    createHash("sha256").update(mutation === "rp" ? "attacker.test" : "localhost").digest().copy(data);
    data[32] = (enrol ? 0x40 : 0) | (mutation === "presence" ? 4 : mutation === "verification" ? 1 : 5);
    data.writeUInt32BE(mutation === "counter" ? 0 : counter, 33);
    if (enrol) { data.writeUInt16BE(id.byteLength, 53); Buffer.from(id).copy(data, 55); }
    return data;
  };
  const clientData = (challenge: ArrayBuffer, enrol = false) => Buffer.from(JSON.stringify({
    type: mutation === "type" ? "webauthn.create" : enrol ? "webauthn.create" : "webauthn.get",
    origin: mutation === "origin" ? "http://attacker.test" : window.location.origin,
    challenge: mutation === "challenge" ? "old-challenge" : b64(challenge),
    crossOrigin: mutation === "crossOrigin",
  }));
  vi.mocked(navigator.credentials.create).mockImplementation(async (options) => {
    const request = options!.publicKey!;
    userHandle = request.user.id as ArrayBuffer;
    return { id: b64(id), rawId: id, type: "public-key", response: {
      clientDataJSON: bytes(clientData(request.challenge as ArrayBuffer, true)),
      getAuthenticatorData: () => bytes(authData(true)),
      getPublicKey: () => bytes(pair.publicKey.export({ format: "der", type: "spki" })),
      getPublicKeyAlgorithm: () => algorithm,
    } } as unknown as PublicKeyCredential;
  });
  vi.mocked(navigator.credentials.get).mockImplementation(async (options) => {
    counter++;
    const client = clientData(options!.publicKey!.challenge as ArrayBuffer);
    const auth = authData();
    const signed = Buffer.concat([auth, createHash("sha256").update(client).digest()]);
    const signature = sign("sha256", signed, pair.privateKey);
    if (mutation === "signature") signature[signature.length - 1] ^= 1;
    if (mutation === "logout") clearAuthStorage();
    return { id: mutation === "credential" ? "wrong-id" : b64(id), rawId: id, type: "public-key", response: {
      clientDataJSON: bytes(client), authenticatorData: bytes(auth), signature: bytes(signature),
      userHandle: mutation === "user" ? bytes(Buffer.from("someone-else")) : userHandle,
    } } as unknown as PublicKeyCredential;
  });
  return { mutate: (next: Mutation) => { mutation = next; } };
}

describe("scoped, signed offline device unlock", () => {
  it.each([-7, -257] as const)("enrolls online and verifies real signatures offline (algorithm %s)", async (algorithm) => {
    authenticator(algorithm);
    await enrolBiometric("owner-a", "Owner", "2468");
    expect(isBiometricEnrolled()).toBe(true);
    expect(mocks.pin).toHaveBeenCalledOnce();
    Object.defineProperty(navigator, "onLine", { value: false });
    await expect(verifyBiometric()).resolves.toBe(true);
    await expect(verifyBiometric()).resolves.toBe(true);
    expect(JSON.parse(localStorage.getItem(DEVICE_UNLOCK_KEY)!).counter).toBe(2);
    const stored = localStorage.getItem(DEVICE_UNLOCK_KEY)!;
    expect(stored).not.toContain("2468");
    expect(stored).not.toContain("privateKey");
  });
  it.each(["challenge", "origin", "crossOrigin", "type", "rp", "presence", "verification", "signature", "credential", "user", "logout"] as Mutation[])("rejects %s without unlocking", async (mutation) => {
    const auth = authenticator();
    await enrolBiometric("owner-a", "Owner", "2468");
    auth.mutate(mutation);
    await expect(verifyBiometric()).rejects.toThrow();
  });
  it("rejects a replayed/decreasing signature counter", async () => {
    const auth = authenticator();
    await enrolBiometric("owner-a", "Owner", "2468");
    await verifyBiometric();
    auth.mutate("counter");
    await expect(verifyBiometric()).rejects.toThrow("counter did not advance");
  });
  it("requires owner approval before enrollment and stores nothing on failure", async () => {
    authenticator();
    mocks.pin.mockRejectedValue(new Error("Wrong PIN"));
    await expect(enrolBiometric("owner-a", "Owner", "1111")).rejects.toThrow("Wrong PIN");
    expect(navigator.credentials.create).not.toHaveBeenCalled();
    expect(isBiometricEnrolled()).toBe(false);
  });
  it("does not trust legacy unscoped enrollment", async () => {
    localStorage.setItem(LEGACY_DEVICE_UNLOCK_KEY, "old-credential");
    expect(isBiometricEnrolled()).toBe(false);
    await expect(verifyBiometric()).rejects.toThrow("Enroll");
  });
  it.each(["user", "shop", "device"])("does not reuse enrollment across %s changes", async (boundary) => {
    authenticator();
    await enrolBiometric("owner-a", "Owner", "2468");
    if (boundary === "user") session("owner-b");
    if (boundary === "shop") session("owner-a", "shop-b");
    if (boundary === "device") mocks.device = "different-device";
    expect(isBiometricEnrolled()).toBe(false);
    await expect(verifyBiometric()).rejects.toThrow("Enroll");
    expect(navigator.credentials.get).not.toHaveBeenCalled();
  });
  it("removes enrollment on logout and explicit forgetting", async () => {
    authenticator();
    await enrolBiometric("owner-a", "Owner", "2468");
    forgetBiometric();
    expect(isBiometricEnrolled()).toBe(false);
    await enrolBiometric("owner-a", "Owner", "2468");
    clearAuthStorage();
    session();
    expect(isBiometricEnrolled()).toBe(false);
  });
  it("keeps enrollment on secret rotation, not on a new login", async () => {
    authenticator();
    saveAuthSession({ refreshToken: "session-a.old-secret" });
    await enrolBiometric("owner-a", "Owner", "2468");
    saveAuthSession({ refreshToken: "session-a.new-secret" });
    await expect(verifyBiometric()).resolves.toBe(true);
    saveAuthSession({ refreshToken: "session-b.secret" });
    expect(isBiometricEnrolled()).toBe(false);
  });
  it("fails closed on cancellation and inaccessible storage", async () => {
    authenticator();
    await enrolBiometric("owner-a", "Owner", "2468");
    vi.mocked(navigator.credentials.get).mockResolvedValue(null);
    await expect(verifyBiometric()).rejects.toThrow("cancelled");
    vi.spyOn(localStorage, "getItem").mockImplementation(() => { throw new Error("storage denied"); });
    expect(isBiometricEnrolled()).toBe(false);
    await expect(verifyBiometric()).rejects.toThrow("Enroll");
  });
});

describe("configured lock policy is network independent", () => {
  const identity = '["owner-a","shop-a"]';
  const now = 1_800_000_000_000;
  it("locks on a cold start, including offline, but allows a completed sign-in", () => {
    vi.stubGlobal("navigator", { onLine: false });
    markCounterActive(identity, now);
    expect(counterStartupDecision(DEFAULT_SECURITY_POLICY, identity, now)).toBe("lock");
    markCounterSessionStarted(identity, now);
    expect(counterStartupDecision(DEFAULT_SECURITY_POLICY, identity, now)).toBe("allow");
    expect(counterStartupDecision(DEFAULT_SECURITY_POLICY, "other", now)).toBe("lock");
  });
  it("retains the idle limit across remounts and rejects future/missing activity", () => {
    markCounterSessionStarted(identity, now);
    markCounterActive(identity, now - 15 * 60_000);
    expect(counterStartupDecision(DEFAULT_SECURITY_POLICY, identity, now)).toBe("lock");
    markCounterActive(identity, now + 1);
    expect(counterIdleDecision(DEFAULT_SECURITY_POLICY, identity, now)).toBe("lock");
    localStorage.clear();
    expect(counterIdleDecision(DEFAULT_SECURITY_POLICY, identity, now)).toBe("lock");
  });
  it("applies sign-out policy independently of PIN availability and network", () => {
    expect(counterStartupDecision({ ...DEFAULT_SECURITY_POLICY, rememberDevice: false }, identity, now)).toBe("logout");
    expect(counterIdleDecision({ ...DEFAULT_SECURITY_POLICY, autoLock: false }, identity, now)).toBe("logout");
    expect(counterIdleDecision(DEFAULT_SECURITY_POLICY, null, now)).toBe("lock");
  });
});
