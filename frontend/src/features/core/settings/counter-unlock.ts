import { verifyOwnerPin } from "./api";
import { authSessionInstance } from "@/lib/storage/auth-storage";

/** Screen unlock only. No offline substitute for a server-authorized money action. */
export async function verifyCounterPin(pin: string): Promise<void> {
  if (!/^\d{4}$/.test(pin)) throw new Error("Enter your 4-digit owner PIN.");
  const instance = authSessionInstance();
  if (!instance) throw new Error("Sign in again to unlock this counter.");
  if (!navigator.onLine) throw new Error("PIN verification needs a connection. Reconnect or use the enrolled device unlock.");
  const result = await verifyOwnerPin(pin);
  if (result?.valid !== true) throw new Error("The server did not verify this PIN. The counter remains locked.");
  if (instance !== authSessionInstance()) {
    throw new Error("The signed-in session changed. Try unlocking again.");
  }
}
