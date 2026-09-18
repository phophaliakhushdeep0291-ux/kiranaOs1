import { verifyOwnerPin } from "./api";
import { authSessionInstance } from "@/lib/storage/auth-storage";
import { canVerifyCounterPinOffline, verifyCounterPinOffline } from "@/lib/storage/counter-pin-offline";

/**
 * Screen unlock only. No offline substitute for a server-authorized money action.
 *
 * `allowOffline` is the counter's escape hatch and nothing else: when the line is
 * down, a PIN this device has already had verified by the server can be checked
 * against a local PBKDF2 verifier (see `counter-pin-offline.ts`). A shop that
 * loses its internet must still be able to unlock the till it is standing at.
 * Callers that ESTABLISH security — enrolling device unlock, for instance — leave
 * it off, so the server is always the one that says yes first.
 *
 * What has not changed: a network failure never becomes an unlock. Offline with
 * no stored verifier still refuses, and so does a failed request while online.
 */
export async function verifyCounterPin(pin: string, { allowOffline = false }: { allowOffline?: boolean } = {}): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error("Enter your 4-digit owner PIN.");
  const instance = authSessionInstance();
  if (!instance) throw new Error("Sign in again to unlock this counter.");
  if (!navigator.onLine) {
    if (allowOffline && canVerifyCounterPinOffline()) {
      await verifyCounterPinOffline(pin);
      if (instance !== authSessionInstance()) throw new Error("The signed-in session changed. Try unlocking again.");
      return;
    }
    throw new Error("PIN verification needs a connection. Reconnect or use the enrolled device unlock.");
  }
  const result = await verifyOwnerPin(pin);
  if (result?.valid !== true) throw new Error("The server did not verify this PIN. The counter remains locked.");
  if (instance !== authSessionInstance()) {
    throw new Error("The signed-in session changed. Try unlocking again.");
  }
  // Arming the offline verifier happens inside `verifyOwnerPin`, so that every
  // online PIN confirmation counts, not just the ones typed on this screen.
}
