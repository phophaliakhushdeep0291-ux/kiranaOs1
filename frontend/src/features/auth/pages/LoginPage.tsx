import { useState } from "react";
import { useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useLogin, type AuthResponse } from "@/lib/api/client";
import { useAuth } from "@/features/auth/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "wouter";
import { Loader2, LockKeyhole, Store } from "lucide-react";

const schema = z.object({
  mobile: z.string().min(10, "Enter a valid mobile number"),
  password: z.string().min(1, "Password is required"),
});
type FormData = z.infer<typeof schema>;

export default function Login() {
  const [, setLocation] = useLocation();
  const auth = useAuth();
  const [serverError, setServerError] = useState<string | null>(null);

  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { mobile: "", password: "" },
  });

  const loginMutation = useLogin({
    mutation: {
      onSuccess: (data: AuthResponse) => {
        auth.login(data.accessToken || data.token, data.refreshToken, data.user, data.shop);
        setLocation("/dashboard");
      },
      onError: (err: unknown) => {
        const msg = (err as { data?: { message?: string }; message?: string })?.data?.message ?? (err as { message?: string })?.message ?? "Login failed";
        setServerError(msg);
      },
    },
  });

  const onSubmit = (values: FormData) => {
    setServerError(null);
    loginMutation.mutate({ data: { mobile: values.mobile, password: values.password } });
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
          <h2 className="mb-5 text-lg font-bold text-card-foreground">Sign in to your shop</h2>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div>
              <Label htmlFor="mobile">Mobile Number</Label>
              <Input
                id="mobile"
                data-testid="input-mobile"
                className="mt-1 h-11 rounded-lg"
                placeholder="9876543210"
                {...form.register("mobile")}
              />
              {form.formState.errors.mobile && (
                <p className="text-destructive text-xs mt-1">{form.formState.errors.mobile.message}</p>
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

            {serverError && (
              <div className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" data-testid="status-error">
                {serverError}
              </div>
            )}

            <Button
              type="submit"
              className="w-full"
              data-testid="button-login"
              disabled={loginMutation.isPending}
            >
              {loginMutation.isPending ? (
                <><Loader2 size={16} className="mr-2 animate-spin" />Signing in...</>
              ) : "Sign In"}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-muted-foreground">
            New shop?{" "}
            <Link href="/register">
              <span className="text-primary font-medium hover:underline cursor-pointer" data-testid="link-register">
                Register here
              </span>
            </Link>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
