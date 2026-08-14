import { useAppLanguage } from "@/features/core/settings/i18n";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Fingerprint, Lock, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/core/auth/useAuth";
import { checkOwnerPin, verifyOwnerPin } from "@/features/core/settings/api";
import { isBiometricEnrolled, verifyBiometric } from "@/features/core/settings/biometric-unlock";
import {
  SECURITY_POLICY_CHANGED_EVENT,
  getSecurityPolicySync,
  loadSecurityPolicy,
  sessionTimeoutMs,
  type SecurityPolicy,
} from "@/features/core/settings/security-policy";

/**
 * Makes Settings -> Security "Session & Login Security" real.
 *
 * - Session timeout + Auto-lock: after the configured idle window the counter is
 *   covered by a PIN lock instead of staying open on a shared till. With
 *   auto-lock off the same window signs the user out completely.
 * - Require login on app start: a cold start (new browser session) locks first.
 * - Remember this device: when off, an expired session signs out instead of
 *   offering the quick PIN unlock, so full credentials are needed again.
 *
 * The idle stamp lives in localStorage so a refresh cannot be used to dodge the
 * lock, and the PIN is checked by the server (POST /auth/pin/verify) — never
 * against anything stored in the browser.
 */

const LAST_ACTIVITY_KEY = "kiranaos.security.lastActivity.v1";
const SESSION_STARTED_KEY = "kiranaos.security.sessionStarted.v1";
const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;

/** Throttled so a busy counter isn't writing to storage on every keystroke. */
const ACTIVITY_WRITE_INTERVAL_MS = 15_000;
const CHECK_INTERVAL_MS = 10_000;

function readLastActivity(): number {
  try {
    const raw = Number(localStorage.getItem(LAST_ACTIVITY_KEY));
    return Number.isFinite(raw) && raw > 0 ? raw : Date.now();
  } catch {
    return Date.now();
  }
}

function writeLastActivity(at: number) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
  } catch {
    /* storage unavailable — the in-memory stamp still guards this tab */
  }
}

/** True the first time the gate mounts in a brand-new browser session. */
function isColdStart(): boolean {
  try {
    if (sessionStorage.getItem(SESSION_STARTED_KEY)) return false;
    sessionStorage.setItem(SESSION_STARTED_KEY, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export function clearSessionLockState() {
  try {
    localStorage.removeItem(LAST_ACTIVITY_KEY);
    sessionStorage.removeItem(SESSION_STARTED_KEY);
  } catch {
    /* nothing to clear */
  }
}

/**
 * A successful password/Google/registration sign-in is already an explicit
 * presence check. Mark this browser session as started so the cold-start rule
 * applies on the next real browser start, not immediately after authentication.
 */
export function markAuthenticatedSessionActive(at = Date.now()) {
  try {
    localStorage.setItem(LAST_ACTIVITY_KEY, String(at));
    sessionStorage.setItem(SESSION_STARTED_KEY, String(at));
  } catch {
    /* storage unavailable — the mounted gate still tracks activity in memory */
  }
}

export function SessionLockGate({ children }: { children: ReactNode }) {
  const { logout, user } = useAuth();
  const [policy, setPolicy] = useState<SecurityPolicy>(() => getSecurityPolicySync());
  const [locked, setLocked] = useState(false);
  const [hasPin, setHasPin] = useState<boolean | null>(null);
  const lastWriteRef = useRef(0);
  const coldStartHandled = useRef(false);

  useEffect(() => {
    void loadSecurityPolicy().then(setPolicy);
    const onChange = () => setPolicy(getSecurityPolicySync());
    window.addEventListener(SECURITY_POLICY_CHANGED_EVENT, onChange);
    return () => window.removeEventListener(SECURITY_POLICY_CHANGED_EVENT, onChange);
  }, []);

  // The unlock is a server PIN check, so a shop with no owner PIN could never
  // get past the screen. Ask once and stay unlocked until we know there is one.
  useEffect(() => {
    let active = true;
    void checkOwnerPin()
      .then((result) => { if (active) setHasPin(Boolean(result.hasPin)); })
      .catch(() => { if (active) setHasPin(null); });
    return () => { active = false; };
  }, []);

  /**
   * Locking is only safe when the counter could actually be unlocked again:
   * an owner PIN must exist and the server must be reachable to verify it.
   * Offline billing is the whole point of this app — it must never be the
   * thing that traps a shopkeeper behind a screen they cannot clear.
   */
  const canLock = hasPin === true && navigator.onLine;

  const markActive = useCallback(() => {
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;
    writeLastActivity(now);
  }, []);

  // Always record activity, even while unlocked with no timeout configured, so
  // turning the timeout on later starts from a real timestamp.
  useEffect(() => {
    if (locked) return;
    writeLastActivity(Date.now());
    lastWriteRef.current = Date.now();
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, markActive, { passive: true });
    return () => {
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
    };
  }, [locked, markActive]);

  // Cold start: lock (or sign out) before anything renders when the owner asked
  // for a login on every app start.
  useEffect(() => {
    if (coldStartHandled.current || hasPin === null) return;
    coldStartHandled.current = true;
    // Consume the cold-start flag either way, so a policy change mid-session
    // cannot retro-lock a counter that is already open.
    const cold = isColdStart();
    if (!cold || !policy.requireLoginOnStart) return;
    if (!canLock) return;
    if (policy.rememberDevice) setLocked(true);
    else void logout();
    // policy is read once on the first mount; later changes apply to the next start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasPin, canLock, policy.requireLoginOnStart, policy.rememberDevice]);

  useEffect(() => {
    const timeout = sessionTimeoutMs(policy);
    if (timeout <= 0 || locked) return;
    const timer = window.setInterval(() => {
      if (Date.now() - readLastActivity() < timeout) return;
      // Re-check reachability at the moment it fires, not when the timer was set.
      if (!navigator.onLine || hasPin !== true) return;
      if (policy.autoLock && policy.rememberDevice) setLocked(true);
      else void logout();
    }, CHECK_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [hasPin, locked, logout, policy]);

  if (!locked) return <>{children}</>;

  return (
    <LockScreen
      userName={user?.name ?? null}
      biometric={policy.biometric && isBiometricEnrolled()}
      onUnlock={() => {
        writeLastActivity(Date.now());
        setLocked(false);
      }}
      onSignOut={() => void logout()}
    />
  );
}

function LockScreen({ userName, biometric, onUnlock, onSignOut }: { userName: string | null; biometric: boolean; onUnlock: () => void; onSignOut: () => void }) {
  const { t } = useAppLanguage();
  const [pin, setPin] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  async function unlockWithBiometric() {
    setChecking(true);
    setError(null);
    try {
      await verifyBiometric();
      onUnlock();
    } catch (err) {
      setError((err as { message?: string })?.message || "Fingerprint / face unlock did not complete.");
    } finally {
      setChecking(false);
    }
  }

  useEffect(() => {
    const timer = window.setTimeout(() => inputRef.current?.focus(), 60);
    return () => window.clearTimeout(timer);
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = pin.trim();
    if (value.length < 4) {
      setError("Enter your 4-digit owner PIN.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await verifyOwnerPin(value);
      onUnlock();
    } catch (err) {
      // A dropped connection is not a wrong PIN. The counter must keep working
      // offline, so an unreachable server releases the lock rather than
      // stranding the shopkeeper mid-sale.
      if (!navigator.onLine || (err as { status?: number })?.status === 0 || err instanceof TypeError) {
        onUnlock();
        return;
      }
      const message = (err as { data?: { message?: string }; message?: string })?.data?.message
        ?? (err as { message?: string })?.message
        ?? "Wrong PIN.";
      setError(message);
      setPin("");
      inputRef.current?.focus();
    } finally {
      setChecking(false);
    }
  }

  return (
    <div
      className="session-lock-screen"
      role="dialog"
      aria-modal="true"
      aria-labelledby="counter-lock-title"
      aria-describedby="counter-lock-description"
    >
      <div className="session-lock-card">
        <span aria-hidden="true" className="session-lock-icon"><Lock size={22} /></span>
        <h1 id="counter-lock-title" className="session-lock-title">{t("settings.lock.locked")}</h1>
        <p id="counter-lock-description" className="session-lock-description">
          {userName ? `${userName}, enter` : "Enter"} the owner PIN to get back to the counter. This lock follows your
          Settings &rarr; Security session rules.
        </p>
        <form className="session-lock-form" onSubmit={(event) => void submit(event)}>
          <Input
            ref={inputRef}
            type="password"
            inputMode="numeric"
            autoComplete="off"
            aria-label={t("inventory.transfers.ownerPin")}
            className="session-lock-input"
            placeholder="••••"
            value={pin}
            disabled={checking}
            onChange={(event) => { setPin(event.target.value); setError(null); }}
          />
          {error ? <p role="alert" className="session-lock-error">{error}</p> : null}
          <Button
            type="submit"
            disabled={checking}
            style={{ background: "linear-gradient(180deg,var(--brand) 0%,var(--brand-strong) 100%)" }}
            className="session-lock-primary"
          >
            {checking ? <><Loader2 size={16} className="animate-spin" /> {t("settings.lock.checking")}</> : <><ShieldCheck size={16} /> {t("settings.lock.unlock")}</>}
          </Button>
          {biometric ? (
            <Button type="button" variant="outline" disabled={checking} className="session-lock-secondary" onClick={() => void unlockWithBiometric()}>
              <Fingerprint size={16} /> Use fingerprint / face
            </Button>
          ) : null}
          <Button type="button" variant="ghost" className="session-lock-signout" onClick={onSignOut}>
            <LogOut size={14} /> Sign out instead
          </Button>
        </form>
      </div>
    </div>
  );
}
