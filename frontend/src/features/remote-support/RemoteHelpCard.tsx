import { useCallback, useEffect, useRef, useState } from "react";
import { Headset, Loader2, ShieldCheck, Sparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { ApiClientError } from "@/lib/api/http";
import {
  createSupportSession,
  getSupportState,
  revokeSupportSession,
  setAutoFixEnabled,
  type SupportCommandDto,
  type SupportScope,
  type SupportSessionDto,
  type SupportStateDto,
} from "./api";

/**
 * The owner's side of remote support: hand out a code, watch what support does
 * with it, take it back at any time.
 *
 * Two things this screen must never do — because they are the whole basis on
 * which a shopkeeper trusts it — are start a session on its own, and hide what was
 * done. Access begins only when the owner taps, and every command support ran is
 * listed underneath in plain language.
 */

function useCountdown(expiresAt: string | null | undefined) {
  const [remaining, setRemaining] = useState(0);

  useEffect(() => {
    if (!expiresAt) {
      setRemaining(0);
      return;
    }
    const tick = () => setRemaining(Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000)));
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);

  return remaining;
}

function formatRemaining(seconds: number) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}:${String(secs).padStart(2, "0")}`;
}

function CommandRow({ command }: { command: SupportCommandDto }) {
  const tone =
    command.status === "applied"
      ? "text-emerald-600 dark:text-emerald-400"
      : command.status === "failed"
        ? "text-destructive"
        : "text-muted-foreground";

  return (
    <li className="flex items-start justify-between gap-3 py-2 first:pt-0 last:pb-0">
      <div className="min-w-0">
        <p className="text-sm text-foreground">{command.ownerSummary ?? command.label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-muted-foreground">
          {command.automatic ? (
            <span className="inline-flex items-center gap-1 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary">
              <Sparkles size={11} aria-hidden="true" />
              Fixed automatically
            </span>
          ) : (
            <span>{command.issuedByEmail ?? "support"}</span>
          )}
          {command.reason ? <span className="truncate">— {command.reason}</span> : null}
        </p>
      </div>
      <span className={`shrink-0 text-xs font-medium capitalize ${tone}`}>{command.status}</span>
    </li>
  );
}

export function RemoteHelpCard() {
  const [state, setState] = useState<SupportStateDto | null>(null);
  const [code, setCode] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const alive = useRef(true);

  const activeSession: SupportSessionDto | null = state?.activeSession ?? null;
  const remaining = useCountdown(activeSession?.expiresAt);

  const refresh = useCallback(async () => {
    try {
      const next = await getSupportState();
      if (alive.current) setState(next);
    } catch {
      // A shopkeeper who cannot reach the server does not need a second error about
      // it — the page they are already on will be saying so.
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    void refresh();
    // While support is in the shop, keep the command list current so the owner can
    // watch it happen rather than having to trust a summary afterwards.
    const timer = window.setInterval(() => void refresh(), 10_000);
    return () => {
      alive.current = false;
      window.clearInterval(timer);
    };
  }, [refresh]);

  // The code dies with the window it belongs to; stop showing a number that has
  // already stopped working.
  useEffect(() => {
    if (remaining === 0 && code) setCode(null);
  }, [remaining, code]);

  async function grant(scope: SupportScope) {
    setBusy(true);
    setError(null);
    try {
      const session = await createSupportSession({ scope });
      if (!alive.current) return;
      setCode(session.code);
      await refresh();
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof ApiClientError ? err.message : "Could not start a support session.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function toggleAutoFix(enabled: boolean) {
    // Optimistic: the switch has to feel instant, and refresh() below reconciles it.
    setState((current) => (current ? { ...current, autoFix: { enabled } } : current));
    try {
      await setAutoFixEnabled(enabled);
    } catch (err) {
      setError(err instanceof ApiClientError ? err.message : "Could not change that setting.");
    } finally {
      await refresh();
    }
  }

  async function revoke() {
    setBusy(true);
    setError(null);
    try {
      await revokeSupportSession(activeSession?.id);
      if (!alive.current) return;
      setCode(null);
      await refresh();
    } catch (err) {
      if (!alive.current) return;
      setError(err instanceof ApiClientError ? err.message : "Could not end the session.");
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  const recentCommands = state?.recentCommands ?? [];

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Headset size={17} aria-hidden="true" className="text-primary" />
          Let support fix it from where they are
        </CardTitle>
        <CardDescription>
          Give support a one-time code and they can check this shop and repair it remotely — no visit, no waiting. Access
          ends by itself, and you can end it sooner at any time.
        </CardDescription>
      </CardHeader>

      <CardContent className="space-y-4">
        {error ? <p className="text-sm text-destructive">{error}</p> : null}

        {!activeSession ? (
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button onClick={() => void grant("repair")} disabled={busy} className="gap-2">
              {busy ? <Loader2 size={15} className="animate-spin" aria-hidden="true" /> : null}
              Get remote help
            </Button>
            <Button variant="outline" onClick={() => void grant("diagnose")} disabled={busy}>
              Let them look only
            </Button>
          </div>
        ) : (
          <div className="space-y-3">
            {code ? (
              <div className="rounded-lg border border-primary/30 bg-primary/[0.04] p-4 text-center">
                <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Read this code to support
                </p>
                <p className="mt-1 font-mono text-4xl font-bold tracking-[0.2em] text-foreground">{code}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Shown once. If you lose it, end the session and start a new one.
                </p>
              </div>
            ) : null}

            <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border bg-muted/40 px-3 py-2.5">
              <div className="flex items-center gap-2 text-sm">
                <ShieldCheck size={15} aria-hidden="true" className="text-emerald-600 dark:text-emerald-400" />
                <span className="text-foreground">
                  {activeSession.operatorEmail
                    ? `${activeSession.operatorEmail} is connected`
                    : "Waiting for support to enter the code"}
                </span>
                <span className="text-muted-foreground">
                  ·{" "}
                  {activeSession.scope === "repair"
                    ? "can view and repair this shop"
                    : "can view this shop, cannot change anything"}
                </span>
              </div>
              <span className="font-mono text-sm text-muted-foreground">{formatRemaining(remaining)} left</span>
            </div>

            <Button variant="destructive" size="sm" onClick={() => void revoke()} disabled={busy} className="gap-2">
              <X size={14} aria-hidden="true" />
              End remote access now
            </Button>
          </div>
        )}

        {/* Unattended fixes need an owner-visible switch, not just a server default.
            Nobody is watching when these run, so the consent has to be standing. */}
        <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border bg-muted/30 p-3">
          <input
            type="checkbox"
            checked={state?.autoFix?.enabled ?? true}
            onChange={(event) => void toggleAutoFix(event.target.checked)}
            className="mt-0.5"
          />
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-medium text-foreground">
              <Sparkles size={14} aria-hidden="true" className="text-primary" />
              Fix small problems automatically
            </span>
            <span className="mt-0.5 block text-xs text-muted-foreground">
              Retries entries that failed to sync and keeps this device up to date, without waiting for support.
              Anything that would interrupt you still waits for a person.
            </span>
          </span>
        </label>

        {recentCommands.length > 0 ? (
          <div>
            <p className="mb-1 text-sm font-semibold text-foreground">What has been done</p>
            <ul className="divide-y">
              {recentCommands.map((command) => (
                <CommandRow key={command.id} command={command} />
              ))}
            </ul>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

export default RemoteHelpCard;
