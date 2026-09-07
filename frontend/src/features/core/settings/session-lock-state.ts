const LOCKED_USER_KEY = "kiranaos.security.lockedUser.v1";

/** Keep an already locked counter locked when its tab reloads. */
export function isSessionLocked(userId?: string): boolean {
  try { return Boolean(userId) && sessionStorage.getItem(LOCKED_USER_KEY) === userId; }
  catch { return false; }
}

export function persistSessionLock(userId?: string) {
  try {
    if (userId) sessionStorage.setItem(LOCKED_USER_KEY, userId);
    else sessionStorage.removeItem(LOCKED_USER_KEY);
  } catch { /* The mounted gate still enforces the lock. */ }
}
