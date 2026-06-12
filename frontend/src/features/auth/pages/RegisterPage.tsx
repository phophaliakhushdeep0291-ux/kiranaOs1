import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRegister, type AuthResponse } from "@/lib/api/client";
import { useAuth } from "@/features/auth/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { ArrowLeft, ArrowRight, CheckCircle2, Loader2, ShieldCheck, Store } from "lucide-react";
import { BUSINESS_TYPE_DEFS, saveBusinessType, type BusinessType } from "@/features/settings/business-types";
import { applyAccent } from "@/features/settings/theme";
import { cn } from "@/lib/utils";

function normalizeIndianMobile(value: unknown) {
  if (typeof value !== "string") return value;
  let text = value.trim().replace(/[\s\-()]/g, "");
  if (text.startsWith("+91")) text = text.slice(3);
  if (text.startsWith("91") && text.length === 12) text = text.slice(2);
  return text;
}

const trimmedString = z.preprocess((value) => typeof value === "string" ? value.trim() : value, z.string());

const schema = z.object({
  shopName: trimmedString.pipe(z.string().min(2, "Shop name required")),
  ownerName: trimmedString.pipe(z.string().min(2, "Owner name required")),
  city: trimmedString.pipe(z.string().min(2, "City required")),
  address: trimmedString.pipe(z.string().min(5, "Address required")),
  mobile: z.preprocess(
    normalizeIndianMobile,
    z.string().regex(/^[6-9]\d{9}$/, "Enter a valid 10-digit Indian mobile number")
  ),
  password: z.string().min(6, "Min 6 characters"),
  ownerPin: z.string().length(4, "Must be exactly 4 digits").regex(/^\d{4}$/, "Digits only"),
});
type FormData = z.infer<typeof schema>;

const BUSINESS_TYPES = Object.entries(BUSINESS_TYPE_DEFS) as [BusinessType, typeof BUSINESS_TYPE_DEFS[BusinessType]][];

export default function Register() {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const [step, setStep] = useState<1 | 2>(1);
  const [selectedType, setSelectedType] = useState<BusinessType>("kirana");
  const [hoveredType, setHoveredType] = useState<BusinessType | null>(null);
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { shopName: "", ownerName: "", city: "", address: "", mobile: "", password: "", ownerPin: "" },
  });

  const registerMutation = useRegister({
    mutation: {
      onSuccess: async (data: AuthResponse) => {
        saveBusinessType(selectedType);
        const accent = BUSINESS_TYPE_DEFS[selectedType].defaultAccent;
        localStorage.setItem("kirana-os:ui-theme:v1", accent);
        applyAccent(accent);
        auth.login(data.accessToken || data.token, data.refreshToken, data.user, data.shop);
        setLocation("/dashboard");
      },
      onError: (err: unknown) => {
        const data = (err as { data?: { message?: string; error?: string; details?: Record<string, string[]> } })?.data;
        const details = data?.details
          ? Object.entries(data.details).flatMap(([field, messages]) => messages.map((msg) => `${field}: ${msg}`)).join(" | ")
          : "";
        setServerError(details || data?.message || data?.error || (err as { message?: string })?.message || "Registration failed");
        setStep(1);
      },
    },
  });

  const goToStep2 = async () => {
    const valid = await form.trigger();
    if (!valid) return;
    // Preview the currently selected type's accent
    applyAccent(BUSINESS_TYPE_DEFS[selectedType].defaultAccent);
    setStep(2);
  };

  const handleTypeHover = (type: BusinessType | null) => {
    setHoveredType(type);
    const previewType = type ?? selectedType;
    applyAccent(BUSINESS_TYPE_DEFS[previewType].defaultAccent);
  };

  const handleTypeSelect = (type: BusinessType) => {
    setSelectedType(type);
    applyAccent(BUSINESS_TYPE_DEFS[type].defaultAccent);
  };

  const onSubmit = (values: FormData) => {
    setServerError(null);
    registerMutation.mutate({ data: values });
  };

  const def = BUSINESS_TYPE_DEFS[hoveredType ?? selectedType];

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8 transition-all duration-500">
      {/* ── STEP 1: Shop details ──────────────────────────────────────────── */}
      {step === 1 && (
        <div className="grid w-full max-w-6xl overflow-hidden rounded-2xl border bg-card shadow-xl lg:grid-cols-[minmax(0,1fr)_480px]">
          <section className="hidden bg-sidebar p-8 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
            <div>
              <div className="inline-flex h-12 w-12 items-center justify-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-md ring-1 ring-white/10">
                <Store size={24} />
              </div>
              <h1 className="mt-6 font-display text-3xl font-black text-white">Set up your shop counter</h1>
              <p className="mt-3 max-w-md text-sm leading-6 text-sidebar-foreground/75">
                Billing, inventory, credit management, and owner controls — all in one place, from day one.
              </p>
            </div>
            <div className="grid gap-3 text-sm">
              {[
                "Works offline — bills even without internet",
                "Owner PIN protects discounts and cancellations",
                "Built for any type of retail shop",
              ].map((item) => (
                <div key={item} className="flex items-center gap-2.5 rounded-xl bg-white/10 px-3 py-2.5 font-semibold ring-1 ring-white/10">
                  <CheckCircle2 size={15} className="shrink-0 text-sidebar-primary" />
                  {item}
                </div>
              ))}
            </div>
          </section>

          <div className="w-full p-6 sm:p-8">
            <div className="mb-6">
              <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-xl bg-primary text-primary-foreground lg:hidden">
                <Store size={28} />
              </div>
              <div className="hidden items-center gap-2 text-sm font-bold text-primary lg:flex">
                <ShieldCheck size={15} />Step 1 of 2 — Shop details
              </div>
              <h1 className="mt-1 font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">Register your shop</h1>
              <p className="mt-1 text-sm text-muted-foreground">Create the owner account and security PIN.</p>
            </div>

            <form className="space-y-3" onSubmit={(e) => e.preventDefault()}>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor="shopName">Shop Name</Label>
                  <Input id="shopName" data-testid="input-shopName" className="mt-1 h-11" placeholder="Sharma General Store" {...form.register("shopName")} />
                  {form.formState.errors.shopName && <p className="mt-1 text-xs text-destructive">{form.formState.errors.shopName.message}</p>}
                </div>
                <div>
                  <Label htmlFor="ownerName">Owner Name</Label>
                  <Input id="ownerName" data-testid="input-ownerName" className="mt-1 h-11" placeholder="Ramesh Sharma" {...form.register("ownerName")} />
                  {form.formState.errors.ownerName && <p className="mt-1 text-xs text-destructive">{form.formState.errors.ownerName.message}</p>}
                </div>
                <div>
                  <Label htmlFor="city">City</Label>
                  <Input id="city" data-testid="input-city" className="mt-1 h-11" placeholder="Mumbai" {...form.register("city")} />
                  {form.formState.errors.city && <p className="mt-1 text-xs text-destructive">{form.formState.errors.city.message}</p>}
                </div>
                <div>
                  <Label htmlFor="mobile">Mobile</Label>
                  <Input id="mobile" data-testid="input-mobile" className="mt-1 h-11" placeholder="9876543210" {...form.register("mobile")} />
                  {form.formState.errors.mobile && <p className="mt-1 text-xs text-destructive">{form.formState.errors.mobile.message}</p>}
                </div>
              </div>
              <div>
                <Label htmlFor="address">Address</Label>
                <Input id="address" data-testid="input-address" className="mt-1 h-11" placeholder="Shop No. 12, Main Market" {...form.register("address")} />
                {form.formState.errors.address && <p className="mt-1 text-xs text-destructive">{form.formState.errors.address.message}</p>}
              </div>
              <div>
                <Label htmlFor="password">Password</Label>
                <Input id="password" data-testid="input-password" type="password" className="mt-1 h-11" placeholder="Min. 6 characters" {...form.register("password")} />
                {form.formState.errors.password && <p className="mt-1 text-xs text-destructive">{form.formState.errors.password.message}</p>}
              </div>
              <div>
                <Label htmlFor="ownerPin">4-Digit Owner PIN</Label>
                <Input id="ownerPin" data-testid="input-ownerPin" type="password" inputMode="numeric" maxLength={4} className="mt-1 h-11" placeholder="e.g. 1234" {...form.register("ownerPin")} />
                <p className="mt-1 text-xs text-muted-foreground">Used to authorise discounts, cancellations, and sensitive settings.</p>
                {form.formState.errors.ownerPin && <p className="mt-1 text-xs text-destructive">{form.formState.errors.ownerPin.message}</p>}
              </div>
              {serverError && (
                <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">{serverError}</div>
              )}
              <Button type="button" className="mt-2 w-full h-11 text-base rounded-xl" onClick={() => void goToStep2()}>
                Continue <ArrowRight size={16} className="ml-2" />
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login">
                <span className="cursor-pointer font-bold text-primary hover:underline" data-testid="link-login">Sign in</span>
              </Link>
            </p>
          </div>
        </div>
      )}

      {/* ── STEP 2: Business type ─────────────────────────────────────────── */}
      {step === 2 && (
        <div className="w-full max-w-4xl">
          <button
            type="button"
            onClick={() => { setStep(1); applyAccent("emerald"); }}
            className="mb-5 flex items-center gap-1.5 text-sm font-semibold text-muted-foreground transition-colors hover:text-foreground"
          >
            <ArrowLeft size={15} /> Back to shop details
          </button>

          <div className="overflow-hidden rounded-2xl border bg-card shadow-xl">
            {/* Header */}
            <div className="border-b bg-primary/5 px-6 py-5">
              <div className="flex items-center gap-2 text-sm font-bold text-primary">
                <ShieldCheck size={15} /> Step 2 of 2 — Choose your business type
              </div>
              <h1 className="mt-1 font-display text-2xl font-black tracking-tight text-foreground sm:text-3xl">
                What kind of shop is this?
              </h1>
              <p className="mt-1 text-sm text-muted-foreground">
                We'll set up the right dashboard, product categories, units, and colour theme for you.
              </p>
            </div>

            {/* Business type grid */}
            <div className="grid grid-cols-2 gap-2 p-5 sm:grid-cols-3 lg:grid-cols-4">
              {BUSINESS_TYPES.map(([key, typeDef]) => {
                const active = selectedType === key;
                return (
                  <button
                    key={key}
                    type="button"
                    onMouseEnter={() => handleTypeHover(key)}
                    onMouseLeave={() => handleTypeHover(null)}
                    onClick={() => handleTypeSelect(key)}
                    className={cn(
                      "group relative flex flex-col items-start gap-2 rounded-xl border-2 p-3.5 text-left transition-all duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      active
                        ? "border-primary bg-primary/5 shadow-sm"
                        : "border-transparent bg-muted/30 hover:border-muted-foreground/25 hover:bg-muted/50"
                    )}
                  >
                    <span className="text-2xl leading-none">{typeDef.emoji}</span>
                    <div className="min-w-0">
                      <p className={cn("text-sm font-black leading-tight", active ? "text-primary" : "text-foreground")}>{typeDef.label}</p>
                      <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground">{typeDef.description}</p>
                    </div>
                    {active && (
                      <span className="absolute right-2 top-2">
                        <CheckCircle2 size={16} className="text-primary" />
                      </span>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Selected preview bar */}
            <div className="border-t bg-muted/30 px-6 py-4">
              <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-2xl leading-none">{def.emoji}</span>
                  <div>
                    <p className="font-black text-foreground">{def.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Dashboard: <span className="font-semibold">{def.dashboard.heroTitle}</span> · Color: <span className="font-semibold capitalize">{def.defaultAccent}</span>
                    </p>
                  </div>
                </div>
                <Button
                  type="button"
                  className="h-11 min-w-[160px] rounded-xl text-base"
                  onClick={form.handleSubmit(onSubmit)}
                  disabled={registerMutation.isPending}
                  data-testid="button-register"
                >
                  {registerMutation.isPending
                    ? <><Loader2 size={16} className="mr-2 animate-spin" />Creating…</>
                    : <>Set up my shop <ArrowRight size={16} className="ml-2" /></>
                  }
                </Button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
