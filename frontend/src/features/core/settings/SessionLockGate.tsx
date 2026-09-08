import { useAppLanguage } from "@/features/core/settings/i18n";
import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import { Fingerprint, Lock, Loader2, LogOut, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAuth } from "@/features/core/auth/useAuth";
import { verifyCounterPin } from "./counter-unlock";
import { isBiometricEnrolled, verifyBiometric } from "./biometric-unlock";
import { isSessionLocked, persistSessionLock } from "./session-lock-state";
import { authSessionIdentity } from "@/lib/storage/auth-storage";
import {
  SECURITY_POLICY_CHANGED_EVENT, getSecurityPolicySync, loadSecurityPolicy,
  type SecurityPolicy,
} from "./security-policy";
import {
  clearCounterActivity, markCounterActive, counterStartupDecision, counterIdleDecision,
  markCounterSessionStarted,
} from "./counter-lock-policy";

const ACTIVITY_EVENTS = ["pointerdown", "keydown", "wheel", "touchstart", "focus"] as const;
const ACTIVITY_WRITE_INTERVAL_MS = 15_000;
const CHECK_INTERVAL_MS = 10_000;

export function clearSessionLockState() {
  persistSessionLock();
  clearCounterActivity();
}

/** Only a completed sign-in or verified unlock may start a new unlocked session. */
export function markAuthenticatedSessionActive(at = Date.now()) {
  persistSessionLock();
  const identity = authSessionIdentity();
  markCounterActive(identity, at);
  markCounterSessionStarted(identity, at);
}

export function SessionLockGate({ children }: { children: ReactNode }) {
  const { user, shop } = useAuth();
  const identity = user?.id ? JSON.stringify([user.id, shop?.id ?? user.shopId]) : null;
  // A shop/user switch cannot inherit the old component's unlocked state.
  return <ScopedSessionLockGate key={identity} identity={identity}>{children}</ScopedSessionLockGate>;
}

function ScopedSessionLockGate({ children, identity }: { children: ReactNode; identity: string | null }) {
  const { logout, user } = useAuth();
  const { t } = useAppLanguage();
  const [policy, setPolicy] = useState<SecurityPolicy>(() => getSecurityPolicySync());
  const [locked, setLocked] = useState(true);
  const [ready, setReady] = useState(false);
  const lastWriteRef = useRef(0);

  const lock = useCallback(() => {
    persistSessionLock(identity ?? undefined);
    setLocked(true);
  }, [identity]);

  useEffect(() => {
    let active = true;
    void loadSecurityPolicy().then((loaded) => {
      if (!active) return;
      setPolicy(loaded);
      const decision = isSessionLocked(identity ?? undefined)
        ? "lock" : counterStartupDecision(loaded, identity);
      markCounterSessionStarted(identity);
      setLocked(decision !== "allow");
      if (decision !== "allow") persistSessionLock(identity ?? undefined);
      setReady(true);
      if (decision === "logout") void logout();
    });
    const onChange = () => setPolicy(getSecurityPolicySync());
    window.addEventListener(SECURITY_POLICY_CHANGED_EVENT, onChange);
    return () => { active = false; window.removeEventListener(SECURITY_POLICY_CHANGED_EVENT, onChange); };
    // Read the startup rule once. Policy changes after opening apply at next start.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [identity]);

  const markActive = useCallback(() => {
    // Returning to a long-idle tab is not proof of presence. Check expiry before
    // focus/keypress can overwrite the durable idle stamp.
    const decision = counterIdleDecision(policy, identity);
    if (decision !== "allow") {
      lock();
      if (decision === "logout") void logout();
      return;
    }
    const now = Date.now();
    if (now - lastWriteRef.current < ACTIVITY_WRITE_INTERVAL_MS) return;
    lastWriteRef.current = now;
    markCounterActive(identity, now);
  }, [identity, lock, logout, policy]);

  useEffect(() => {
    if (!ready || locked) return;
    // Do not reset last activity on mount: refresh must not defeat the timeout.
    for (const event of ACTIVITY_EVENTS) window.addEventListener(event, markActive, { passive: true });
    const timer = window.setInterval(() => {
      const decision = counterIdleDecision(policy, identity);
      if (decision === "allow") return;
      lock();
      if (decision === "logout") void logout();
    }, CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(timer);
      for (const event of ACTIVITY_EVENTS) window.removeEventListener(event, markActive);
    };
  }, [identity, ready, locked, lock, logout, markActive, policy]);

  // Neither page components nor their effects mount before the local rule is read.
  if (!ready) return <div role="status" className="session-lock-screen">{t("settings.lock.checking")}</div>;
  if (!locked) return <>{children}</>;

  return (
    <LockScreen
      userName={user?.name ?? null}
      biometric={policy.biometric && isBiometricEnrolled()}
      onUnlock={() => {
        if (identity !== authSessionIdentity()) return;
        persistSessionLock();
        markCounterActive(identity);
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
    if (checking) return;
    setChecking(true);
    setError(null);
    try {
      if (await verifyBiometric() !== true) throw new Error(t("settings.lock.deviceNotVerified"));
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
    if (checking) return;
    const value = pin.trim();
    if (!/^\d{4}$/.test(value)) {
      setError("Enter your 4-digit owner PIN.");
      return;
    }
    setChecking(true);
    setError(null);
    try {
      await verifyCounterPin(value);
      onUnlock();
    } catch (err) {
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
        <p className="session-lock-description">{t("settings.lock.connectionHelp")}</p>
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
            <Button type="button" data-testid="device-unlock" variant="outline" disabled={checking} className="session-lock-secondary" onClick={() => void unlockWithBiometric()}>
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
