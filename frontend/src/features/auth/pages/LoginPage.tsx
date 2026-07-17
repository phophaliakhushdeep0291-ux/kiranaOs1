import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { useLogin, type AuthResponse } from "@/lib/api/client";
import { googleLogin as googleLoginRequest } from "@/features/auth/api";
import { GoogleSignInButton, isGoogleSignInConfigured } from "@/features/auth/GoogleSignInButton";
import { stashGoogleSignupPrefill } from "@/features/auth/google-signup";
import { useAuth } from "@/features/auth/useAuth";
import { getLandingRoute } from "@/features/settings/landing-page";
import { consumePostLoginRedirect } from "@/features/auth/post-login-redirect";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { completeDeviceReplacement, type ActiveDeviceDto } from "@/features/devices/api";
import { ChevronLeft, ChevronRight, Laptop, Loader2, LockKeyhole, Store } from "lucide-react";

const schema = z.object({
  identifier: z.string().min(3, "Enter your mobile number or email"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

interface DeviceLimitState {
  message: string;
  activeDevices: ActiveDeviceDto[];
  deviceLimitToken: string;
  plan?: { code?: string; maxDevices?: number; allowedMaxDevices?: number };
}

interface ShopChoice {
  id: string;
  name: string;
  city?: string | null;
}

function getErrorData(error: unknown): Record<string, unknown> {
  if (!error || typeof error !== "object") return {};
  const data = (error as { data?: unknown }).data;
  if (data && typeof data === "object" && !Array.isArray(data)) return data as Record<string, unknown>;
  return {};
}

function getErrorCode(error: unknown): string | undefined {
  const data = getErrorData(error);
  return typeof data.code === "string" ? data.code : undefined;
}

function getErrorMessage(error: unknown, fallback: string): string {
  const data = getErrorData(error);
  if (typeof data.message === "string") return data.message;
  if (typeof data.error === "string") return data.error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
    return (error as { message: string }).message;
  }
  return fallback;
}

function getShopChoices(error: unknown): ShopChoice[] {
  const shops = getErrorData(error).shops;
  if (!Array.isArray(shops)) return [];

  return shops.filter((shop): shop is ShopChoice => {
    if (!shop || typeof shop !== "object") return false;
    const candidate = shop as Record<string, unknown>;
    return typeof candidate.id === "string" && typeof candidate.name === "string";
  });
}

export default function Login() {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);
  const [shopChoices, setShopChoices] = useState<ShopChoice[] | null>(null);
  const [loginShopId, setLoginShopId] = useState<string | null>(null);
  const [deviceLimit, setDeviceLimit] = useState<DeviceLimitState | null>(null);
  const [revokingDeviceId, setRevokingDeviceId] = useState<string | null>(null);
  const [selectedReplacementDeviceId, setSelectedReplacementDeviceId] = useState<string | null>(null);
  const [replacementOwnerPin, setReplacementOwnerPin] = useState("");
  // When set, the pending sign-in is Google-based: shop selection and device-limit
  // retries must replay the Google credential instead of the password form.
  const [googleCredential, setGoogleCredential] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "", password: "" },
  });

  const handleAuthSuccess = (data: AuthResponse) => {
    auth.login(data.accessToken || data.token, data.refreshToken, data.user, data.shop);
    const next = consumePostLoginRedirect();
    if (next) {
      // A deep link with a #hash (e.g. the QR order import) needs a full navigation to
      // restore the fragment; plain paths can stay in-SPA.
      if (next.includes("#")) window.location.replace(next);
      else setLocation(next);
    } else {
      setLocation(getLandingRoute());
    }
  };

  const handleAuthError = (err: unknown) => {
    const errorCode = getErrorCode(err);
    const shops = getShopChoices(err);
    if (errorCode === "SHOP_SELECTION_REQUIRED" || shops.length > 0) {
      if (shops.length === 0) {
        setServerError("Select your shop to continue, but the shop list was not included. Please try again.");
        return;
      }
      setShopChoices(shops);
      setLoginShopId(null);
      setDeviceLimit(null);
      setServerError(null);
      return;
    }
    if (errorCode === "DEVICE_LIMIT_EXCEEDED") {
      const errorData = getErrorData(err);
      const activeDevices = Array.isArray(errorData.activeDevices) ? errorData.activeDevices as ActiveDeviceDto[] : [];
      const token = typeof errorData.deviceLimitToken === "string" ? errorData.deviceLimitToken : "";
      setShopChoices(null);
      setDeviceLimit({
        message: getErrorMessage(err, "Device limit reached"),
        activeDevices,
        deviceLimitToken: token,
        plan: typeof errorData.plan === "object" && errorData.plan ? errorData.plan as DeviceLimitState["plan"] : undefined,
      });
      setSelectedReplacementDeviceId(null);
      setReplacementOwnerPin("");
      setServerError(null);
      return;
    }
    setServerError(getErrorMessage(err, "Login failed"));
  };

  const loginMutation = useLogin({
    mutation: {
      onSuccess: handleAuthSuccess,
      onError: handleAuthError,
    },
  });

  const googleMutation = useMutation({
    mutationFn: googleLoginRequest,
    onSuccess: handleAuthSuccess,
    onError: (err: unknown) => {
      // First Google sign-in with no account yet: take them to registration with the
      // verified Google identity prefilled. They set a password there (offline-first
      // accounts need one); the next Google sign-in links automatically by email.
      if (getErrorCode(err) === "GOOGLE_ACCOUNT_NOT_REGISTERED") {
        const errorData = getErrorData(err);
        const email = typeof errorData.email === "string" ? errorData.email : "";
        const name = typeof errorData.name === "string" ? errorData.name : null;
        if (email) stashGoogleSignupPrefill({ email, name });
        setLocation("/register");
        return;
      }
      handleAuthError(err);
    },
  });

  const authPending = loginMutation.isPending || googleMutation.isPending;

  const onGoogleCredential = (credential: string) => {
    setServerError(null);
    setShopChoices(null);
    setLoginShopId(null);
    setDeviceLimit(null);
    setGoogleCredential(credential);
    googleMutation.mutate({ credential });
  };

  const onSubmit = (values: FormData) => {
    setServerError(null);
    setShopChoices(null);
    setLoginShopId(null);
    setDeviceLimit(null);
    setGoogleCredential(null);
    loginMutation.mutate({ data: { identifier: values.identifier, password: values.password } });
  };

  const selectShop = (shopId: string) => {
    setLoginShopId(shopId);
    setServerError(null);
    if (googleCredential) {
      googleMutation.mutate({ credential: googleCredential, shopId });
      return;
    }
    const values = form.getValues();
    loginMutation.mutate({ data: { identifier: values.identifier, password: values.password, shopId } });
  };

  const backToSignIn = () => {
    setShopChoices(null);
    setLoginShopId(null);
    setDeviceLimit(null);
    setServerError(null);
    setGoogleCredential(null);
    setSelectedReplacementDeviceId(null);
    setReplacementOwnerPin("");
  };

  const replaceSelectedDevice = async () => {
    if (!deviceLimit?.deviceLimitToken) {
      setServerError("Device management session expired. Please sign in again.");
      setDeviceLimit(null);
      return;
    }
    if (!selectedReplacementDeviceId) {
      setServerError("Select one registered device to replace.");
      return;
    }
    if (!/^\d{4}$/.test(replacementOwnerPin)) {
      setServerError("Enter the 4-digit owner PIN to continue.");
      return;
    }
    setRevokingDeviceId(selectedReplacementDeviceId);
    setServerError(null);
    try {
      const result = await completeDeviceReplacement({
        replacementToken: deviceLimit.deviceLimitToken,
        targetDeviceId: selectedReplacementDeviceId,
        ownerPin: replacementOwnerPin,
      });
      handleAuthSuccess(result);
    } catch (error) {
      setServerError(getErrorMessage(error, "Could not replace that device"));
    } finally {
      setRevokingDeviceId(null);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-[#f4f7fc] px-4 py-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-[26px] border border-[#dce5f2] bg-card shadow-[0_28px_80px_rgba(16,35,71,0.16)] lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="relative hidden overflow-hidden bg-[linear-gradient(145deg,#031126_0%,#06275f_58%,#075fff_135%)] p-10 text-white lg:flex lg:flex-col lg:justify-between">
          <div className="pointer-events-none absolute -right-28 -top-28 h-80 w-80 rounded-full border border-white/10 bg-white/5" />
          <div className="pointer-events-none absolute -bottom-36 -left-28 h-96 w-96 rounded-full border border-white/10 bg-[#075fff]/25" />
          <div>
            <div className="relative inline-flex h-12 w-12 items-center justify-center rounded-[14px] bg-[#075fff] text-white shadow-[0_14px_30px_rgba(0,74,255,0.35)] ring-1 ring-white/20">
              <Store size={24} aria-hidden="true" />
            </div>
            <p className="relative mt-8 text-[11px] font-black uppercase tracking-[0.2em] text-[#78a8ff]">Retail operating system</p>
            <h1 className="relative mt-3 font-display text-4xl font-black tracking-tight text-white">Vey<span className="text-[#4c8dff]">ra</span></h1>
            <h2 className="relative mt-7 max-w-md font-display text-[30px] font-black leading-[1.08] tracking-tight text-white">Run the counter.<br />Know the business.</h2>
            <p className="relative mt-4 max-w-md text-sm leading-6 text-white/70">
              Fast billing, clear cash visibility, customer credit, inventory, and reliable offline work—built for every kind of retail counter.
            </p>
          </div>
          <div className="relative grid gap-3 text-sm">
            {["Works offline at the counter", "Keeps owner cash signals visible", "Syncs safely when network returns"].map((item) => (
              <div key={item} className="rounded-[12px] bg-white/[0.07] px-4 py-3 font-semibold text-white/88 ring-1 ring-white/10 backdrop-blur-sm">
                {item}
              </div>
            ))}
          </div>
        </section>

        <div className="w-full p-6 sm:p-9">
        <div className="mb-8 text-center lg:text-left">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
            <Store className="text-primary-foreground" size={28} />
          </div>
          <div className="hidden items-center gap-2 text-sm font-bold text-primary lg:flex">
            <LockKeyhole size={16} aria-hidden="true" />
            Secure shop sign in
          </div>
          <h1 className="font-display text-3xl font-black tracking-tight text-foreground lg:mt-3">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage today&apos;s counter.</p>
        </div>

        <div className="rounded-[18px] border border-[#dce5f2] bg-white p-5 shadow-[0_12px_36px_rgba(16,35,71,0.07)]">
          {shopChoices ? (
            <div className="space-y-4" data-testid="shop-selection-panel">
              <div>
                <h2 className="text-lg font-bold text-card-foreground">Choose your shop</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  Select the shop you want to manage.
                </p>
              </div>

              <div className="space-y-2">
                {shopChoices.map((shop) => (
                  <button
                    key={shop.id}
                    type="button"
                    className="flex min-h-16 w-full items-center gap-3 rounded-lg border bg-card p-3 text-left transition-colors hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    onClick={() => selectShop(shop.id)}
                    disabled={authPending}
                    data-testid={`shop-choice-${shop.id}`}
                  >
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Store size={19} aria-hidden="true" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-card-foreground">{shop.name}</span>
                      {shop.city && <span className="block truncate text-xs text-muted-foreground">{shop.city}</span>}
                    </span>
                    {authPending && loginShopId === shop.id
                      ? <Loader2 size={18} className="shrink-0 animate-spin text-primary" aria-label="Opening shop" />
                      : <ChevronRight size={18} className="shrink-0 text-muted-foreground" aria-hidden="true" />}
                  </button>
                ))}
              </div>

              {serverError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">
                  {serverError}
                </div>
              )}

              <Button type="button" variant="outline" className="w-full" onClick={backToSignIn} disabled={authPending}>
                <ChevronLeft size={16} className="mr-2" aria-hidden="true" />
                Back to sign in
              </Button>
            </div>
          ) : deviceLimit ? (
            <div className="space-y-4" data-testid="device-limit-panel">
              <div>
                <h2 className="text-lg font-bold text-card-foreground">Device limit reached</h2>
                <p className="mt-1 text-sm text-muted-foreground">
                  {deviceLimit.message}
                </p>
                {deviceLimit.plan?.code && (
                  <p className="mt-2 inline-flex rounded-full bg-primary/10 px-3 py-1 text-xs font-bold text-primary">
                    {deviceLimit.plan.code} plan - {deviceLimit.plan.allowedMaxDevices ?? deviceLimit.plan.maxDevices} registered devices
                  </p>
                )}
              </div>

              <div className="max-h-[42vh] space-y-2 overflow-y-auto pr-1">
                {deviceLimit.activeDevices.map((device) => (
                  <button
                    key={device.deviceId}
                    type="button"
                    className={`flex w-full items-center gap-3 rounded-lg border p-3 text-left transition-colors ${selectedReplacementDeviceId === device.deviceId ? "border-primary bg-primary/5 ring-1 ring-primary" : "bg-card hover:border-primary/50"}`}
                    onClick={() => setSelectedReplacementDeviceId(device.deviceId)}
                    disabled={revokingDeviceId !== null || device.current}
                  >
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Laptop size={18} />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-bold text-card-foreground">{device.deviceName || "Active device"}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {device.userName || "Shop user"}{device.lastSeenAt ? ` - last used ${new Date(device.lastSeenAt).toLocaleString()}` : ""}
                      </p>
                    </div>
                    <span className={`grid h-5 w-5 shrink-0 place-items-center rounded-full border ${selectedReplacementDeviceId === device.deviceId ? "border-primary bg-primary text-primary-foreground" : "border-muted-foreground/40"}`}>
                      {selectedReplacementDeviceId === device.deviceId ? <span className="h-2 w-2 rounded-full bg-white" /> : null}
                    </span>
                  </button>
                ))}
              </div>

              <div className="space-y-2 rounded-lg border bg-muted/30 p-3">
                <Label htmlFor="replacement-owner-pin">Owner PIN</Label>
                <Input
                  id="replacement-owner-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={4}
                  autoComplete="one-time-code"
                  value={replacementOwnerPin}
                  onChange={(event) => setReplacementOwnerPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                  placeholder="4-digit PIN"
                />
                <p className="text-xs text-muted-foreground">Removing a device immediately revokes its sessions. Unsynced local records on that device are preserved for owner-approved recovery.</p>
              </div>

              {serverError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">
                  {serverError}
                </div>
              )}

              <div className="grid gap-2 sm:grid-cols-2">
                <Button type="button" variant="outline" onClick={backToSignIn}>
                  Back to sign in
                </Button>
                <Button type="button" onClick={() => void replaceSelectedDevice()} disabled={!selectedReplacementDeviceId || replacementOwnerPin.length !== 4 || revokingDeviceId !== null}>
                  {revokingDeviceId ? <><Loader2 size={16} className="mr-2 animate-spin" />Replacing...</> : "Remove selected device and continue"}
                </Button>
              </div>
            </div>
          ) : (
          <>
          <h2 className="mb-5 text-lg font-bold text-card-foreground">Sign in to your shop</h2>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="mobile">Mobile number or email</Label>
              <Input
                id="mobile"
                data-testid="input-mobile"
                className="mt-1 h-11 rounded-lg"
                placeholder="9876543210 or owner@gmail.com"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.identifier.message}</p>
              )}
            </div>

            <div>
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                data-testid="input-password"
                type="password"
                className="mt-1 h-11 rounded-lg"
                placeholder="Enter your password"
                {...form.register("password")}
              />
              {form.formState.errors.password && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.password.message}</p>
              )}
            </div>

            <div className="-mt-2 flex justify-end">
              <Link href="/forgot-password">
                <span className="cursor-pointer text-sm font-semibold text-primary hover:underline">
                  Forgot password?
                </span>
              </Link>
            </div>

            {serverError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">
                {serverError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              data-testid="button-login"
              disabled={authPending}
            >
              {authPending ? (
                <><Loader2 size={16} className="mr-2 animate-spin" />Signing in...</>
              ) : "Sign In"}
            </Button>
          </form>

          {isGoogleSignInConfigured() && (
            <div className="mt-5">
              <div className="flex items-center gap-3">
                <span className="h-px flex-1 bg-border" />
                <span className="text-xs font-semibold uppercase text-muted-foreground">or</span>
                <span className="h-px flex-1 bg-border" />
              </div>
              <div className="mt-4">
                <GoogleSignInButton onCredential={onGoogleCredential} />
              </div>
            </div>
          )}

          <p className="mt-5 text-center text-sm text-muted-foreground">
            New shop?{" "}
            <Link href="/register">
              <span className="text-primary font-medium hover:underline cursor-pointer" data-testid="link-register">
                Register here
              </span>
            </Link>
          </p>
          </>
          )}
        </div>
        </div>
      </div>
    </div>
  );
}
