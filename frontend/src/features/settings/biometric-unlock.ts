/**
 * Biometric unlock for the counter lock screen.
 *
 * This is a *screen lock*, not a login: the browser's platform authenticator
 * (Windows Hello, Touch ID, Android fingerprint) proves the person in front of
 * the till is the one who enrolled, so the cashier can resume without retyping
 * the owner PIN. The credential is created and asserted entirely on this device;
 * it never replaces the server-side PIN check used for money-sensitive actions.
 *
 * Enrolment is per-device on purpose — the handle lives in localStorage, so
 * clearing site data or switching devices simply falls back to the PIN.
 */

const CREDENTIAL_KEY = "kiranaos.security.biometricCredential.v1";

function toBase64Url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): ArrayBuffer {
  const padded = value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return buffer;
}

function randomChallenge(): ArrayBuffer {
  const buffer = new ArrayBuffer(32);
  crypto.getRandomValues(new Uint8Array(buffer));
  return buffer;
}

function encodeUserId(value: string): ArrayBuffer {
  const bytes = new TextEncoder().encode(value.slice(0, 64) || "artha-user");
  const buffer = new ArrayBuffer(bytes.length);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}

/** Whether this browser exposes a built-in fingerprint / face authenticator. */
export async function isBiometricAvailable(): Promise<boolean> {
  const available = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof available !== "function") return false;
  try {
    return await available.call(window.PublicKeyCredential);
  } catch {
    return false;
  }
}

export function isBiometricEnrolled(): boolean {
  try {
    return Boolean(localStorage.getItem(CREDENTIAL_KEY));
  } catch {
    return false;
  }
}

export function forgetBiometric(): void {
  try {
    localStorage.removeItem(CREDENTIAL_KEY);
  } catch {
    /* nothing stored */
  }
}

/** Enrol this device. Throws with a readable message when the user cancels. */
export async function enrolBiometric(userId: string, userName: string): Promise<void> {
  if (!(await isBiometricAvailable())) throw new Error("This device has no fingerprint or face unlock available.");
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomChallenge(),
      rp: { name: "Artha", id: window.location.hostname },
      user: {
        id: encodeUserId(userId),
        name: userName || "Artha user",
        displayName: userName || "Artha user",
      },
      // ES256 then RS256 — every platform authenticator supports one of these.
      pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
      authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
      timeout: 60_000,
      attestation: "none",
    },
  }) as PublicKeyCredential | null;
  if (!credential) throw new Error("Fingerprint / face setup was cancelled.");
  try {
    localStorage.setItem(CREDENTIAL_KEY, toBase64Url(credential.rawId));
  } catch {
    throw new Error("This browser will not store the unlock key.");
  }
}

/**
 * Prompt for the device biometric. Resolves true only when the authenticator
 * reports a verified user; anything else (cancel, timeout, wrong finger) throws.
 */
export async function verifyBiometric(): Promise<boolean> {
  let stored: string | null = null;
  try {
    stored = localStorage.getItem(CREDENTIAL_KEY);
  } catch {
    stored = null;
  }
  if (!stored) throw new Error("This device is not enrolled for biometric unlock yet.");
  const assertion = await navigator.credentials.get({
    publicKey: {
      challenge: randomChallenge(),
      allowCredentials: [{ type: "public-key", id: fromBase64Url(stored) }],
      userVerification: "required",
      timeout: 60_000,
    },
  }) as PublicKeyCredential | null;
  if (!assertion) throw new Error("Unlock was cancelled.");
  return true;
}
