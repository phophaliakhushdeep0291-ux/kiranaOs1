/**
 * Offline SCREEN unlock with the owner PIN.
 *
 * The counter locks on idle whether or not there is a connection, but PIN
 * verification is server-side, so a shop whose line went down could lock itself
 * out of its own till: fifteen quiet minutes during an outage and nobody could
 * bill until the internet came back. Device unlock (WebAuthn) was the only way
 * through, and it is off by default and can only be enrolled while online — so
 * the escape hatch was usually not armed on the day it was needed.
 *
 * This stores a verifier — never the PIN — derived from a PIN the SERVER has
 * already accepted, so an offline unlock is still a positive check against
 * something only a successful online verification could have created. A network
 * failure on its own still unlocks nothing.
 *
 * Security boundary is the same one `biometric-unlock.ts` states: this is a
 * screen lock, never login and never authorization for a money action. Those
 * still go to the server behind `requireOwnerPin`. Local data or script
 * tampering is outside a screen lock's threat model; physical custody is the
 * OS lock and disk encryption's job.
 */
import { authSessionInstance } from "./auth-storage";
import { getPermanentDeviceId } from "@/lib/device-identity";
import { COUNTER_PIN_OFFLINE_KEY } from "./device-unlock-storage";

/** OWASP's PBKDF2-HMAC-SHA256 floor. A 4-digit PIN is only 10,000 guesses, so the
 *  per-guess cost, not the secret, is what makes an offline attack expensive. */
const ITERATIONS = 210_000;
/** Mirrors the server's OWNER_PIN_MAX_FAILURES / OWNER_PIN_LOCKOUT_MINUTES defaults,
 *  so a thief gets no cheaper a ride offline than online. */
const MAX_FAILURES = 5;
const LOCKOUT_MS = 15 * 60_000;
/** A verifier the server has not re-confirmed in this long stops being trusted:
 *  long enough to outlast any realistic outage, short enough that a changed PIN
 *  cannot keep opening a device that never comes back online. */
const MAX_AGE_MS = 30 * 24 * 60 * 60_000;

interface Verifier {
  version: 1;
  scope: string;
  salt: string;
  hash: string;
  iterations: number;
  verifiedAt: number;
  failures: number;
  lockedUntil: number;
}

function scope(): string | null {
  const identity = authSessionInstance();
  return identity ? JSON.stringify([identity, getPermanentDeviceId()]) : null;
}

function encode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

const BASE64URL = /^[A-Za-z0-9_-]+$/;

function decode(value: string): Uint8Array {
  if (!BASE64URL.test(value)) throw new Error("Invalid offline unlock record.");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0));
}

function read(): Verifier | null {
  try {
    const row = JSON.parse(window.localStorage.getItem(COUNTER_PIN_OFFLINE_KEY) ?? "null") as Verifier | null;
    const current = scope();
    if (row?.version !== 1 || !current || row.scope !== current) return null;
    // Charset-checked here, not at use: a corrupted record must read as "this
    // device is not armed" and get the ordinary reconnect message, rather than
    // throwing base64 noise onto the lock screen.
    if (!BASE64URL.test(row.salt ?? "") || !BASE64URL.test(row.hash ?? "")) return null;
    if (!Number.isInteger(row.iterations) || row.iterations < ITERATIONS) return null;
    if (!Number.isInteger(row.verifiedAt) || row.verifiedAt <= 0) return null;
    if (!Number.isInteger(row.failures) || row.failures < 0) return null;
    if (!Number.isInteger(row.lockedUntil) || row.lockedUntil < 0) return null;
    // A clock pushed backwards must not extend trust, and one pushed forwards
    // must not expire it early; treat anything not in the window as unusable.
    const age = Date.now() - row.verifiedAt;
    if (age < 0 || age > MAX_AGE_MS) return null;
    return row;
  } catch {
    return null;
  }
}

function write(row: Verifier): void {
  try { window.localStorage.setItem(COUNTER_PIN_OFFLINE_KEY, JSON.stringify(row)); } catch { /* an unwritable verifier simply means online-only unlock */ }
}

export function forgetOfflineCounterPin(): void {
  if (typeof window === "undefined") return;
  try { window.localStorage.removeItem(COUNTER_PIN_OFFLINE_KEY); } catch { /* nothing to forget */ }
}

async function derive(pin: string, salt: Uint8Array, iterations: number): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(pin), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", salt: salt as BufferSource, iterations, hash: "SHA-256" }, key, 256);
  return encode(bits);
}

/** Equal-length compare that does not return early on the first differing byte. */
function matches(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/**
 * Record a PIN the server has just accepted, so this device can verify it during
 * an outage. Call this ONLY on the success path of an online verification.
 */
export async function rememberCounterPin(pin: string): Promise<void> {
  if (typeof window === "undefined") return;
  const current = scope();
  if (!current || !/^\d{4}$/.test(pin)) return;
  try {
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const hash = await derive(pin, salt, ITERATIONS);
    // The session may have changed while PBKDF2 ran; a verifier must not outlive
    // the identity it was derived under.
    if (scope() !== current) return;
    write({ version: 1, scope: current, salt: encode(salt.buffer as ArrayBuffer), hash, iterations: ITERATIONS, verifiedAt: Date.now(), failures: 0, lockedUntil: 0 });
  } catch {
    // No Web Crypto, no offline unlock. The online path is unaffected.
  }
}

/** Whether this device could verify a PIN without the network right now. */
export function canVerifyCounterPinOffline(): boolean {
  if (typeof window === "undefined") return false;
  return read() !== null;
}

/**
 * Verify a PIN against the stored verifier. Throws with a message fit for the
 * lock screen; resolves only on a positive match.
 */
export async function verifyCounterPinOffline(pin: string): Promise<void> {
  const row = read();
  if (!row) throw new Error("This device cannot check the PIN while offline. Reconnect to unlock.");
  const now = Date.now();
  if (row.lockedUntil > now) {
    const minutes = Math.max(1, Math.ceil((row.lockedUntil - now) / 60_000));
    throw new Error(`Too many wrong PINs. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}, or reconnect to unlock.`);
  }
  const hash = await derive(pin, decode(row.salt), row.iterations);
  // Re-read: a concurrent tab may have moved the counter while PBKDF2 ran, and
  // the session may have changed underneath us.
  const latest = read();
  if (!latest || latest.hash !== row.hash) throw new Error("Offline unlock changed. Try again.");
  if (!matches(hash, latest.hash)) {
    const failures = latest.failures + 1;
    write({ ...latest, failures, lockedUntil: failures >= MAX_FAILURES ? now + LOCKOUT_MS : latest.lockedUntil });
    throw new Error("That PIN did not match. The counter stays locked.");
  }
  // Success clears the run of failures but does NOT refresh `verifiedAt`: only the
  // server may extend how long this device is trusted offline.
  write({ ...latest, failures: 0, lockedUntil: 0 });
}
