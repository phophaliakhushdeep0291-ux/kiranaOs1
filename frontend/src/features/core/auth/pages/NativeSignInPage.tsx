import { useEffect, useState } from "react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ApiClientError } from "@/lib/api/http";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { GoogleSignInButton, isGoogleSignInConfigured } from "../GoogleSignInButton";
import { isNativeApp, nativeAuthRequest, type NativeLoginInfo } from "../native-login";

export default function NativeSignInPage() {
  const { t } = useAppLanguage();
  const [requestId] = useState(() => window.location.hash.slice(1));
  const [info, setInfo] = useState<NativeLoginInfo | null>(null);
  const [code, setCode] = useState("");
  const [credential, setCredential] = useState<string | null>(null);
  const [shops, setShops] = useState<{ id: string; name: string }[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [expired, setExpired] = useState(false);
  useEffect(() => {
    if (isNativeApp || !/^[A-Za-z0-9_-]{43}$/.test(requestId)) { setError(t("auth.native.invalid")); return; }
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;
    void nativeAuthRequest<NativeLoginInfo>("inspect", { requestId }, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setInfo(result);
      timer = setTimeout(() => { setExpired(true); setCredential(null); }, Math.max(0, result.expiresAt - Date.now()));
    }).catch(failure => { if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : t("auth.loginFailed")); });
    return () => { controller.abort(); clearTimeout(timer); };
  }, [requestId, t]);
  async function approve(shopId?: string) {
    if (!credential || busy || expired || code.length !== 8) return;
    setBusy(true);
    setError(null);
    try {
      await nativeAuthRequest("approve", { requestId, userCode: code, credential, ...(shopId ? { shopId } : {}) });
      setCredential(null);
      setDone(true);
    } catch (failure) {
      if (failure instanceof ApiClientError && failure.data.code === "SHOP_SELECTION_REQUIRED" && Array.isArray(failure.data.shops)) {
        setShops(failure.data.shops.filter((shop): shop is { id: string; name: string } => Boolean(shop && typeof shop.id === "string" && typeof shop.name === "string")));
      } else setError(failure instanceof Error ? failure.message : t("auth.loginFailed"));
    } finally { setBusy(false); }
  }
  return <main className="flex min-h-screen items-center justify-center bg-background px-5 py-10">
    <section className="w-full max-w-md space-y-5 rounded-2xl border bg-card p-6 shadow-sm">
      <h1 className="text-2xl font-bold">{t("auth.native.title")}</h1>
      {done ? <p role="status">{t("auth.native.done")}</p> : expired ? <p role="alert">{t("auth.native.expired")}</p> : <>
        <p className="text-sm text-muted-foreground">{t("auth.native.safety")}</p>
        {info && <>
          <p className="break-words font-semibold">{info.deviceName}</p>
          <div className="space-y-2">
            <Label htmlFor="native-code">{t("auth.native.codeLabel")}</Label>
            <Input id="native-code" inputMode="numeric" autoComplete="off" maxLength={8} value={code} disabled={busy} onChange={event => setCode(event.target.value.replace(/\D/g, ""))} className="font-mono text-xl tracking-widest" />
          </div>
          {!isGoogleSignInConfigured() ? <p role="alert">{t("auth.native.unconfigured")}</p>
            : !credential ? <GoogleSignInButton nonce={info.nonce} onCredential={value => { setCredential(value); setError(null); }} onFailure={() => setError(t("auth.native.googleFailed"))} />
              : <>
                <p className="text-sm">{t("auth.native.confirmHelp")}</p>
                {shops.length ? <div className="space-y-2"><p>{t("auth.chooseShop")}</p>{shops.map(shop => <Button key={shop.id} type="button" className="w-full" disabled={busy || code.length !== 8} onClick={() => void approve(shop.id)}>{shop.name}</Button>)}</div>
                  : <Button type="button" className="w-full" disabled={busy || code.length !== 8} onClick={() => void approve()}>{busy ? t("auth.signingIn") : t("auth.native.approve")}</Button>}
                <Button type="button" variant="ghost" className="w-full" disabled={busy} onClick={() => { setCredential(null); setShops([]); }}>{t("auth.native.changeAccount")}</Button>
              </>}
        </>}
        {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
        <Link href="/login" className="block text-sm underline">{t("auth.native.webLogin")}</Link>
      </>}
    </section>
  </main>;
}
