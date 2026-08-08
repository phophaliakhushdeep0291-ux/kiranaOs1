import crypto from "node:crypto";

const CODE_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export const PAIRING_TTL_MS = 10 * 60 * 1000;

function digest(salt, code) {
  return crypto.createHash("sha256").update(`${salt}:${code}`).digest("hex");
}

export function generatePairingCode(randomBytes = crypto.randomBytes) {
  const bytes = randomBytes(6);
  return [...bytes].map((value) => CODE_ALPHABET[value % CODE_ALPHABET.length]).join("");
}

export function createPairingRecord({ code = generatePairingCode(), now = Date.now(), ttlMs = PAIRING_TTL_MS } = {}) {
  const normalized = String(code).trim().toUpperCase();
  if (!/^[2-9A-HJ-NP-Z]{6}$/.test(normalized)) throw new Error("Pairing code must contain six supported characters.");
  const salt = crypto.randomBytes(16).toString("hex");
  return {
    code: normalized,
    pairing: { salt, digest: digest(salt, normalized), expiresAt: now + ttlMs, consumedAt: null, failedAttempts: 0 },
  };
}

export function consumePairingCode(pairing, suppliedCode, now = Date.now()) {
  if (!pairing?.salt || !pairing?.digest) throw Object.assign(new Error("Open Hardware Bridge Setup to create a new pairing code."), { status: 409 });
  if (pairing.consumedAt) throw Object.assign(new Error("This pairing code was already used. Create a new code in Hardware Bridge Setup."), { status: 409 });
  if (!Number.isFinite(Number(pairing.expiresAt)) || now >= Number(pairing.expiresAt)) {
    throw Object.assign(new Error("This pairing code expired. Create a new code in Hardware Bridge Setup."), { status: 410 });
  }
  if (Number(pairing.failedAttempts || 0) >= 5) throw Object.assign(new Error("Too many attempts. Create a new pairing code in Hardware Bridge Setup."), { status: 429 });
  const supplied = String(suppliedCode || "").trim().toUpperCase();
  const expectedBuffer = Buffer.from(String(pairing.digest), "hex");
  const actualBuffer = Buffer.from(digest(pairing.salt, supplied), "hex");
  if (expectedBuffer.length !== actualBuffer.length || !crypto.timingSafeEqual(expectedBuffer, actualBuffer)) {
    pairing.failedAttempts = Number(pairing.failedAttempts || 0) + 1;
    throw Object.assign(new Error("Pairing code is not correct."), { status: 401, persistPairing: true });
  }
  pairing.consumedAt = now;
  return pairing;
}
