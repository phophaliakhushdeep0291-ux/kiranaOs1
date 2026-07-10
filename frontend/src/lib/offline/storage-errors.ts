/**
 * Storage-quota failure handling for the offline layer.
 *
 * When the origin's IndexedDB quota is exhausted, Dexie writes reject with a
 * QuotaExceededError (usually wrapped, with the original DOMException on
 * `.inner` or `.cause`). Without special handling that surfaces to the shopkeeper
 * as a generic "could not save" toast with no way forward. The offline layer
 * detects it, frees what it safely can, and rethrows a typed error whose message
 * tells the user what actually happened.
 */

export const STORAGE_FULL_CODE = "STORAGE_FULL";

export const STORAGE_FULL_MESSAGE =
  "Device storage is full. Old synced history was cleared automatically — please try saving again. If this keeps happening, free up space on this device.";

export class StorageFullError extends Error {
  code = STORAGE_FULL_CODE;

  constructor(message = STORAGE_FULL_MESSAGE) {
    super(message);
    this.name = "StorageFullError";
  }
}

/** Walks the error and its wrapped causes looking for a quota failure. */
export function isQuotaExceededError(error: unknown, depth = 0): boolean {
  if (!error || typeof error !== "object" || depth > 4) return false;
  const candidate = error as { name?: unknown; code?: unknown; inner?: unknown; cause?: unknown };
  if (candidate.name === "QuotaExceededError") return true;
  // Legacy DOMException code for quota (22) — some WebKit builds still use it.
  if (candidate.code === 22) return true;
  return (
    isQuotaExceededError(candidate.inner, depth + 1) ||
    isQuotaExceededError(candidate.cause, depth + 1)
  );
}
