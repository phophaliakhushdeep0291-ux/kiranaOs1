import crypto from "node:crypto";
import { AppError } from "../../middleware/error.js";

const TTL_MS = 5 * 60_000;
const digest = value => crypto.createHash("sha256").update(value).digest("hex");
const equal = (a, b) => typeof a === "string" && typeof b === "string" && a.length === b.length
  && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
const expired = () => new AppError("This app sign-in expired or was already used. Start again in KiranaOS.", 410, "NATIVE_LOGIN_EXPIRED");

/** Short-lived browser approval, bound to a private verifier and installation.
 * No Google/access/refresh token is stored or placed in a URL. Store CAS must be
 * atomic across API instances: only one poll can consume an approved request. */
export function createNativeLoginService({ store, approveIdentity, completeLogin, now = Date.now }) {
  async function read(requestId) {
    const raw = await store.get(requestId);
    if (!raw) throw expired();
    const state = JSON.parse(raw);
    if (state.expiresAt <= now()) throw expired();
    return { raw, state };
  }
  function checkPrivate(state, verifier, reqMeta) {
    if (!equal(state.verifierHash, digest(verifier)) || state.deviceId !== reqMeta.deviceId) {
      throw new AppError("This sign-in belongs to another installation.", 403, "NATIVE_LOGIN_PROOF_INVALID");
    }
  }
  return {
    async start({ verifier, device }, reqMeta) {
      if (!reqMeta.deviceId) throw new AppError("A device id is required.", 400, "DEVICE_ID_REQUIRED");
      if (reqMeta.deviceId.length < 3 || reqMeta.deviceId.length > 128) throw new AppError("Invalid device id.", 400, "DEVICE_ID_INVALID");
      const requestId = crypto.randomBytes(32).toString("base64url");
      const userCode = String(crypto.randomInt(0, 100_000_000)).padStart(8, "0");
      const expiresAt = now() + TTL_MS;
      await store.put(requestId, JSON.stringify({
        status: "pending", verifierHash: digest(verifier), codeHash: digest(userCode), attempts: 0,
        deviceId: reqMeta.deviceId, device: { ...device, deviceId: reqMeta.deviceId },
        nonce: crypto.randomBytes(32).toString("base64url"), expiresAt,
      }), TTL_MS);
      return { requestId, userCode, expiresAt, intervalMs: 3000 };
    },
    async inspect({ requestId }) {
      const { state } = await read(requestId);
      if (state.status !== "pending") throw expired();
      return { deviceName: state.device.deviceName || "KiranaOS", nonce: state.nonce, expiresAt: state.expiresAt };
    },
    async approve({ requestId, userCode, credential, shopId }) {
      const { raw, state } = await read(requestId);
      if (state.status !== "pending") throw expired();
      if (!equal(state.codeHash, digest(userCode))) {
        await store.swap(requestId, raw, state.attempts >= 4 ? null : JSON.stringify({ ...state, attempts: state.attempts + 1 }));
        throw new AppError("The code does not match the code in KiranaOS. Check the app and try again.", 400, "NATIVE_LOGIN_CODE_INVALID");
      }
      const approval = await approveIdentity(credential, state.nonce, shopId);
      if (!await store.swap(requestId, raw, JSON.stringify({ ...state, status: "approved", approval }))) throw expired();
      return { approved: true };
    },
    async poll({ requestId, verifier }, reqMeta) {
      const { raw, state } = await read(requestId);
      checkPrivate(state, verifier, reqMeta);
      if (state.status === "pending") return { status: "pending" };
      if (!await store.swap(requestId, raw, null)) throw expired();
      // Consume before issuing a device-bound session. A lost final response
      // requires fresh approval; replay never issues a second session.
      const auth = await completeLogin(state.approval, { ...reqMeta, device: state.device });
      return { status: "complete", auth };
    },
    async cancel({ requestId, verifier }, reqMeta) {
      const { raw, state } = await read(requestId);
      checkPrivate(state, verifier, reqMeta);
      await store.swap(requestId, raw, null);
      return { cancelled: true };
    },
  };
}
