import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { ApiClientError } from "@/lib/api/http";
import type { AuthResponse } from "@/types/api";
import { closeNativeLoginBrowser, nativeAuthRequest, openNativeLoginBrowser, pollNativeLogin, startNativeLogin, type NativeLoginProof, type NativeLoginRequest } from "./native-login";

interface LoginRun { controller: AbortController; proof?: NativeLoginProof; timer?: ReturnType<typeof setTimeout> }

export function NativeGoogleSignIn({ disabled, onSuccess, onError, onBusy }: {
  disabled: boolean; onSuccess: (auth: AuthResponse) => void; onError: (error: unknown) => void; onBusy: (busy: boolean) => void;
}) {
  const { t } = useAppLanguage();
  const [request, setRequest] = useState<NativeLoginRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const running = useRef<LoginRun | null>(null);
  const callbacks = useRef({ onSuccess, onError, onBusy });
  callbacks.current = { onSuccess, onError, onBusy };
  function dispose() {
    const run = running.current;
    running.current = null;
    run?.controller.abort();
    clearTimeout(run?.timer);
    if (run?.proof) void nativeAuthRequest("cancel", run.proof).catch(() => undefined);
  }
  useEffect(() => () => dispose(), []);
  function finish() {
    dispose();
    setBusy(false);
    setRequest(null);
    callbacks.current.onBusy(false);
  }
  async function start() {
    if (running.current || disabled) return;
    setError(null);
    setBusy(true);
    callbacks.current.onBusy(true);
    const run: LoginRun = { controller: new AbortController() };
    running.current = run;
    try {
      const started = await startNativeLogin(run.controller.signal);
      if (running.current !== run) return;
      run.proof = { requestId: started.requestId, verifier: started.verifier };
      setRequest(started);
      await openNativeLoginBrowser(started.requestId);
      const poll = async () => {
        if (running.current !== run) return;
        try {
          if (Date.now() >= started.expiresAt) throw new Error(t("auth.native.expired"));
          const result = await pollNativeLogin(run.proof!, run.controller.signal);
          if (running.current !== run) return;
          if (result.status === "complete") {
            run.proof = undefined; // Consumed; no cancellation request needed.
            finish();
            void closeNativeLoginBrowser();
            callbacks.current.onSuccess(result.auth);
          } else run.timer = setTimeout(poll, started.intervalMs);
        } catch (failure) {
          if (running.current !== run) return;
          // Brief disconnects while the browser is open do not discard approval.
          if (Date.now() < started.expiresAt && (!(failure instanceof ApiClientError) || failure.status >= 500 || failure.status === 429)) {
            run.timer = setTimeout(poll, 5000);
            return;
          }
          finish();
          callbacks.current.onError(failure);
        }
      };
      void poll();
    } catch (failure) {
      if (running.current !== run) return;
      finish();
      setError(failure instanceof ApiClientError && failure.status === 404 ? t("auth.native.updateRequired") : failure instanceof Error ? failure.message : t("auth.loginFailed"));
    }
  }
  return <div className="space-y-3" data-testid="native-google-signin">
    {busy ? <p className="text-center text-sm font-semibold" role="status">{t("auth.native.waiting")}</p>
      : <Button type="button" variant="outline" className="w-full" disabled={disabled} onClick={() => void start()}>{t("auth.native.google")}</Button>}
    {request && <div className="space-y-3 rounded-xl border bg-muted/40 p-3 text-center" role="status">
      <p className="text-sm">{t("auth.native.codeHelp")}</p>
      <p className="font-mono text-2xl font-bold tracking-widest" data-testid="native-login-code">{request.userCode}</p>
      <p className="text-xs text-muted-foreground">{t("auth.native.returnHelp")}</p>
      <Button type="button" variant="outline" className="w-full" onClick={() => void openNativeLoginBrowser(request.requestId).catch(() => setError(t("auth.native.openFailed")))}>{t("auth.native.openBrowser")}</Button>
    </div>}
    {busy && <Button type="button" variant="ghost" className="w-full" onClick={finish}>{t("auth.native.cancel")}</Button>}
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
  </div>;
}
