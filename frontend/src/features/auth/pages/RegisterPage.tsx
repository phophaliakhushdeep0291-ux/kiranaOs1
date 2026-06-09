import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useRegister, type AuthResponse } from "@/lib/api/client";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Loader2, ShieldCheck, Store } from "lucide-react";

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

export default function Register() {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { shopName: "", ownerName: "", city: "", address: "", mobile: "", password: "", ownerPin: "" },
  });

  const registerMutation = useRegister({
    mutation: {
      onSuccess: async (data: AuthResponse) => {
        auth.login(data.accessToken || data.token, data.refreshToken, data.user, data.shop);
        setLocation("/dashboard");
      },
      onError: (err: unknown) => {
        const data = (err as { data?: { message?: string; error?: string; details?: Record<string, string[]> } })?.data;
        const details = data?.details
          ? Object.entries(data.details)
              .flatMap(([field, messages]) => messages.map((message) => `${field}: ${message}`))
              .join(" | ")
          : "";
        const msg = details || data?.message || data?.error || (err as { message?: string })?.message || "Registration failed";
        setServerError(msg);
      },
    },
  });

  const onSubmit = (values: FormData) => {
    setServerError(null);
    registerMutation.mutate({ data: values });
  };

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="grid w-full max-w-6xl overflow-hidden rounded-lg border bg-card shadow-xl lg:grid-cols-[minmax(0,1fr)_460px]">
        <section className="hidden bg-sidebar p-8 text-sidebar-foreground lg:flex lg:flex-col lg:justify-between">
          <div>
            <div className="inline-flex h-12 w-12 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground shadow-md ring-1 ring-white/10">
              <Store size={24} aria-hidden="true" />
            </div>
            <h1 className="mt-6 text-3xl font-black text-white">Open your KiranaOS counter</h1>
            <p className="mt-3 max-w-md text-sm leading-6 text-sidebar-foreground/75">
              Set up billing, inventory, udhar, and owner controls for a real shop workflow from day one.
            </p>
          </div>
          <div className="grid gap-3 text-sm">
            {["Owner PIN protects sensitive actions", "Offline billing works on this device", "Reports stay tied to saved shop data"].map((item) => (
              <div key={item} className="rounded-lg bg-white/10 px-3 py-2 font-semibold ring-1 ring-white/10">
                {item}
              </div>
            ))}
          </div>
        </section>

        <div className="w-full p-6 sm:p-8">
          <div className="mb-6 text-center lg:text-left">
            <div className="mb-4 inline-flex h-14 w-14 items-center justify-center rounded-lg bg-primary text-primary-foreground lg:hidden">
              <Store className="text-primary-foreground" size={28} />
            </div>
            <div className="hidden items-center gap-2 text-sm font-bold text-primary lg:flex">
              <ShieldCheck size={16} aria-hidden="true" />
              Shop setup
            </div>
            <h1 className="text-3xl font-black text-foreground lg:mt-3">Register your shop</h1>
            <p className="mt-1 text-sm text-muted-foreground">Create the owner account and local security PIN.</p>
          </div>

          <div className="rounded-lg border bg-background/70 p-5 shadow-sm">
            <h2 className="mb-5 text-lg font-bold">Create shop account</h2>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-3">
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
              <div className="grid gap-3 sm:grid-cols-2">
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
                <p className="mt-1 text-xs text-muted-foreground">Used to authorise sensitive actions like discounts and cancellations</p>
                {form.formState.errors.ownerPin && <p className="mt-1 text-xs text-destructive">{form.formState.errors.ownerPin.message}</p>}
              </div>

              {serverError && (
                <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">{serverError}</div>
              )}

              <Button type="submit" className="mt-2 w-full" data-testid="button-register" disabled={registerMutation.isPending}>
                {registerMutation.isPending ? <><Loader2 size={16} className="mr-2 animate-spin" />Creating...</> : "Create Account"}
              </Button>
            </form>
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Already have an account?{" "}
              <Link href="/login">
                <span className="cursor-pointer font-medium text-primary hover:underline" data-testid="link-login">Sign in</span>
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
