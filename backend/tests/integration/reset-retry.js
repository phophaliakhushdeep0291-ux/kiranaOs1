import { setTimeout as delay } from "node:timers/promises";

const WRITE_CONFLICT_STATES = new Set(["40001", "40P01"]);

function isResetWriteConflict(error) {
  if (error?.code === "P2034" || WRITE_CONFLICT_STATES.has(error?.code)) return true;
  if (error?.code === "P2010" && WRITE_CONFLICT_STATES.has(String(error?.meta?.code))) return true;
  // Prisma also wraps a cascading delete deadlock as UnknownRequestError,
  // with the PostgreSQL SQLSTATE in its connector message instead of meta.
  return /PostgresError\s*\{[^}]*code:\s*\\?["'](?:40001|40P01)\\?["']/.test(String(error?.message ?? ""));
}

/** Retry only an aborted test-reset transaction, recreating its query promises. */
export async function retryDatabaseReset(reset, { attempts = 3, wait = delay } = {}) {
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 5) throw new RangeError("Reset attempts must be between 1 and 5");
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await reset();
    } catch (error) {
      if (!isResetWriteConflict(error) || attempt >= attempts) throw error;
      await wait(50 * attempt);
    }
  }
}
