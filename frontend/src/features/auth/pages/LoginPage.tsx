import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { ApiClientError, useLogin, type AuthResponse } from "@/lib/api/client";
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

function getShopChoices(error: ApiClientError): ShopChoice[] {
  const shops = error.data.shops;
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
    if (err instanceof ApiClientError && err.data?.code === "SHOP_SELECTION_REQUIRED") {
      const shops = getShopChoices(err);
      if (shops.length > 0) {
        setShopChoices(shops);
        setLoginShopId(null);
        setDeviceLimit(null);
        setServerError(null);
        return;
      }
    }
    if (err instanceof ApiClientError && err.data?.code === "DEVICE_LIMIT_EXCEEDED") {
      const activeDevices = Array.isArray(err.data.activeDevices) ? err.data.activeDevices as ActiveDeviceDto[] : [];
      const token = typeof err.data.deviceLimitToken === "string" ? err.data.deviceLimitToken : "";
      setShopChoices(null);
      setDeviceLimit({
        message: err.message,
        activeDevices,
        deviceLimitToken: token,
        plan: typeof err.data.plan === "object" && err.data.plan ? err.data.plan as DeviceLimitState["plan"] : undefined,
      });
      setSelectedReplacementDeviceId(null);
      setReplacementOwnerPin("");
      setServerError(null);
      return;
    }
    const msg = (err as { data?: { message?: string }; message?: string })?.data?.message ?? (err as { message?: string })?.message ?? "Login failed";
    setServerError(msg);
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
      if (err instanceof ApiClientError && err.data?.code === "GOOGLE_ACCOUNT_NOT_REGISTERED") {
        const email = typeof err.data.email === "string" ? err.data.email : "";
        const name = typeof err.data.name === "string" ? err.data.name : null;
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
      const msg = error instanceof ApiClientError ? error.message : "Could not replace that device";
      setServerError(msg);
    } finally {
      setRevokingDeviceId(null);
    }
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="grid w-full max-w-5xl overflow-hidden rounded-lg border bg-card shadow-xl lg:grid-cols-[minmax(0,1fr)_420px]">
        <section className="hidden bg-sidebar p-8 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md ring-1 ring-white/10">
              <Store size={24} aria-hidden="true" />
            </div>
            <h1 className="mt-6 text-3xl font-black text-white">KiranaOS</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-sidebar-foreground/75">
              Fast counter billing, udhar tracking, inventory, and offline-safe shop operations in one focused workspace.
            </p>
          </div>
          <div className="grid gap-3 text-sm">
            {["Works offline at the counter", "Keeps owner cash signals visible", "Syncs safely when network returns"].map((item) => (
              <div key={item} className="rounded-lg bg-white/10 px-3 py-2 font-semibold ring-1 ring-white/10">
                {item}
              </div>
            ))}
          </div>
        </section>

        <div className="w-full p-6 sm:p-8">
        <div className="mb-8 text-center lg:text-left">
          <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
            <Store className="text-primary-foreground" size={28} />
          </div>
          <div className="hidden items-center gap-2 text-sm font-bold text-primary lg:flex">
            <LockKeyhole size={16} aria-hidden="true" />
            Secure shop sign in
          </div>
          <h1 className="text-3xl font-black text-foreground lg:mt-3">Welcome back</h1>
          <p className="mt-1 text-sm text-muted-foreground">Sign in to manage today&apos;s counter.</p>
        </div>

        <div className="rounded-lg border bg-background/70 p-5 shadow-sm">
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
                    {deviceLimit.plan.code} plan - {deviceLimit.plan.allowedMaxDevices ?? deviceLimit.plan.maxDevices} active devices
                  </p>
                )}
              </div>

              <div className="space-y-2">
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
