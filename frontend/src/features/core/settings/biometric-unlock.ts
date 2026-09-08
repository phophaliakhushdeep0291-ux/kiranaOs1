/**
 * Offline SCREEN lock, never server login or authorization for protected actions.
 * The OS holds the private key. Only its public key is stored here, scoped to
 * user + shop + device. Local data/script tampering is outside a screen lock's
 * security boundary; use the OS lock and disk encryption for physical custody.
 * Legacy unscoped handles are not trusted: enrol again with a verified PIN.
 */
import { authSessionInstance, loadAuthSession } from "@/lib/storage/auth-storage";
import { getPermanentDeviceId } from "@/lib/device-identity";
import { clearDeviceUnlock, DEVICE_UNLOCK_KEY } from "@/lib/storage/device-unlock-storage";
import { verifyCounterPin } from "./counter-unlock";

interface Enrollment {
  version: 2;
  scope: string;
  id: string;
  userHandle: string;
  publicKey: string;
  algorithm: -7 | -257;
  counter: number;
}

function scope(): string | null {
  const identity = authSessionInstance();
  return identity ? JSON.stringify([identity, getPermanentDeviceId()]) : null;
}

function encode(buffer: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): ArrayBuffer {
  if (!/^[A-Za-z0-9_-]+$/.test(value)) throw new Error("Invalid device unlock key. Enrol this device again.");
  return Uint8Array.from(atob(value.replaceAll("-", "+").replaceAll("_", "/")), (char) => char.charCodeAt(0)).buffer;
}

function randomChallenge(): ArrayBuffer {
  return crypto.getRandomValues(new Uint8Array(32)).buffer;
}

function readEnrollment(): Enrollment | null {
  try {
    const row = JSON.parse(window.localStorage.getItem(DEVICE_UNLOCK_KEY) ?? "null") as Enrollment | null;
    if (row?.version !== 2 || !row.scope || row.scope !== scope() || !row.id || !row.userHandle || !row.publicKey
      || ![-7, -257].includes(row.algorithm) || !Number.isInteger(row.counter) || row.counter < 0) return null;
    return row;
  } catch { return null; }
}

export async function isBiometricAvailable(): Promise<boolean> {
  const available = window.PublicKeyCredential?.isUserVerifyingPlatformAuthenticatorAvailable;
  if (typeof available !== "function") return false;
  try { return await available.call(window.PublicKeyCredential); } catch { return false; }
}

export function isBiometricEnrolled(): boolean { return readEnrollment() !== null; }
export function forgetBiometric(): void { clearDeviceUnlock(); }

function validateClientData(buffer: ArrayBuffer, challenge: ArrayBuffer, type: string) {
  const data = JSON.parse(new TextDecoder().decode(buffer));
  if (data.type !== type || data.challenge !== encode(challenge) || data.origin !== window.location.origin
    || (data.crossOrigin !== undefined && data.crossOrigin !== false)) {
    throw new Error("Device unlock response did not match this request.");
  }
}

async function validateAuthenticatorData(buffer: ArrayBuffer): Promise<number> {
  const data = new Uint8Array(buffer);
  const expected = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(window.location.hostname)));
  if (data.length < 37 || data.slice(0, 32).some((byte, i) => byte !== expected[i]) || (data[32] & 5) !== 5) {
    throw new Error("The device did not verify a user for this app.");
  }
  return new DataView(buffer).getUint32(33, false);
}

async function importPublicKey(row: Pick<Enrollment, "publicKey" | "algorithm">) {
  return crypto.subtle.importKey("spki", decode(row.publicKey), row.algorithm === -7
    ? { name: "ECDSA", namedCurve: "P-256" }
    : { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
}

/** WebAuthn ES256 uses ASN.1 DER; Web Crypto expects the fixed 64-byte r||s. */
function es256Signature(signature: ArrayBuffer): ArrayBuffer {
  const bytes = new Uint8Array(signature);
  if (bytes[0] !== 0x30 || bytes[1] !== bytes.length - 2) throw new Error("Invalid device signature.");
  const result = new Uint8Array(64);
  let offset = 2;
  for (let part = 0; part < 2; part++) {
    if (bytes[offset++] !== 2) throw new Error("Invalid device signature.");
    const length = bytes[offset++];
    let value = bytes.slice(offset, offset + length);
    if (!length || value.length !== length || (value[0] & 0x80)) throw new Error("Invalid device signature.");
    if (value[0] === 0 && value.length > 1) {
      if (!(value[1] & 0x80)) throw new Error("Invalid device signature.");
      value = value.slice(1);
    }
    if (value.length > 32) throw new Error("Invalid device signature.");
    result.set(value, part * 32 + 32 - value.length);
    offset += length;
  }
  if (offset !== bytes.length) throw new Error("Invalid device signature.");
  return result.buffer;
}

export async function enrolBiometric(userId: string, userName: string, ownerPin: string): Promise<void> {
  const currentScope = scope();
  const session = loadAuthSession();
  if (!currentScope || userId !== session.user?.id) throw new Error("Sign in before enrolling this device.");
  await verifyCounterPin(ownerPin);
  if (!(await isBiometricAvailable())) throw new Error("This device has no fingerprint or face unlock available.");
  const challenge = randomChallenge();
  const userHandle = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(currentScope));
  const credential = await navigator.credentials.create({ publicKey: {
    challenge,
    rp: { name: "Artha", id: window.location.hostname },
    user: { id: userHandle, name: userName || "Artha user", displayName: userName || "Artha user" },
    pubKeyCredParams: [{ type: "public-key", alg: -7 }, { type: "public-key", alg: -257 }],
    authenticatorSelection: { authenticatorAttachment: "platform", userVerification: "required", residentKey: "preferred" },
    timeout: 60_000,
    attestation: "none",
  } }) as PublicKeyCredential | null;
  if (!credential || credential.type !== "public-key" || credential.id !== encode(credential.rawId)) throw new Error("Device unlock setup was cancelled or returned an invalid credential.");
  const response = credential.response as AuthenticatorAttestationResponse;
  validateClientData(response.clientDataJSON, challenge, "webauthn.create");
  if (typeof response.getPublicKey !== "function" || typeof response.getAuthenticatorData !== "function") throw new Error("Update this browser to enroll secure device unlock.");
  const data = response.getAuthenticatorData();
  const counter = await validateAuthenticatorData(data);
  const bytes = new Uint8Array(data);
  if (bytes.length < 55 || !(bytes[32] & 0x40)) throw new Error("Invalid device enrollment data.");
  const idLength = new DataView(data).getUint16(53, false);
  if (!idLength || bytes.length < 55 + idLength || encode(data.slice(55, 55 + idLength)) !== credential.id) throw new Error("Device enrollment ID did not match.");
  const publicKey = response.getPublicKey();
  const algorithm = response.getPublicKeyAlgorithm();
  if (!publicKey || (algorithm !== -7 && algorithm !== -257)) throw new Error("Unsupported device unlock key.");
  const row: Enrollment = { version: 2, scope: currentScope, id: credential.id, userHandle: encode(userHandle), publicKey: encode(publicKey), algorithm, counter };
  await importPublicKey(row);
  if (currentScope !== scope()) throw new Error("The signed-in session changed. Enrol again.");
  window.localStorage.setItem(DEVICE_UNLOCK_KEY, JSON.stringify(row));
}

export async function verifyBiometric(): Promise<boolean> {
  const row = readEnrollment();
  if (!row) throw new Error("Enroll device unlock for this account in Settings → Security while connected.");
  const challenge = randomChallenge();
  const assertion = await navigator.credentials.get({ publicKey: {
    challenge, rpId: window.location.hostname,
    allowCredentials: [{ type: "public-key", id: decode(row.id), transports: ["internal"] }],
    userVerification: "required", timeout: 60_000,
  } }) as PublicKeyCredential | null;
  if (!assertion || assertion.type !== "public-key" || assertion.id !== row.id || encode(assertion.rawId) !== row.id) throw new Error("Unlock was cancelled or returned the wrong credential.");
  const response = assertion.response as AuthenticatorAssertionResponse;
  validateClientData(response.clientDataJSON, challenge, "webauthn.get");
  if (response.userHandle !== null && encode(response.userHandle) !== row.userHandle) throw new Error("Device unlock belongs to another account.");
  const counter = await validateAuthenticatorData(response.authenticatorData);
  if ((row.counter !== 0 || counter !== 0) && counter <= row.counter) throw new Error("Device unlock counter did not advance. Re-enroll this device while connected.");
  const clientHash = new Uint8Array(await crypto.subtle.digest("SHA-256", response.clientDataJSON));
  const signed = new Uint8Array(response.authenticatorData.byteLength + clientHash.length);
  signed.set(new Uint8Array(response.authenticatorData));
  signed.set(clientHash, response.authenticatorData.byteLength);
  const key = await importPublicKey(row);
  const verified = await crypto.subtle.verify(row.algorithm === -7 ? { name: "ECDSA", hash: "SHA-256" } : "RSASSA-PKCS1-v1_5",
    key, row.algorithm === -7 ? es256Signature(response.signature) : response.signature, signed);
  if (!verified) throw new Error("The device unlock signature could not be verified.");
  if (JSON.stringify(readEnrollment()) !== JSON.stringify(row)) throw new Error("Device unlock changed. Try again.");
  window.localStorage.setItem(DEVICE_UNLOCK_KEY, JSON.stringify({ ...row, counter }));
  return true;
}
