import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResetPassword } from "@/features/core/auth/queries";

const schema = z.object({
  newPassword: z.string().min(6, "Min 6 characters"),
  confirmPassword: z.string().min(6, "Confirm your password"),
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "Passwords do not match",
  path: ["confirmPassword"],
});

type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const [, setLocation] = useLocation();
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, []);
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { newPassword: "", confirmPassword: "" },
  });
  const resetPassword = useResetPassword({
    mutation: {
      onSuccess: () => {
        setSuccess(true);
        setServerError(null);
      },
      onError: (error) => setServerError(error.message || "Could not reset password"),
    },
  });

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound size={24} />
          </div>
          <h1 className="text-2xl font-black text-foreground">Set a new password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Choose a strong password. All old sessions will be logged out.
          </p>
        </div>

        {!token ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              This reset link is missing a token. Please request a new link.
            </div>
            <Button asChild className="h-11 w-full">
              <Link href="/forgot-password">Request new link</Link>
            </Button>
          </div>
        ) : success ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              Password updated. Please sign in with your new password.
            </div>
            <Button type="button" className="h-11 w-full" onClick={() => setLocation("/login")}>
              Sign in
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => resetPassword.mutate({ data: { token, newPassword: values.newPassword } }))}
          >
            <div>
              <Label htmlFor="newPassword">New password</Label>
              <Input id="newPassword" type="password" className="mt-1 h-11 rounded-xl" {...form.register("newPassword")} />
              {form.formState.errors.newPassword && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.newPassword.message}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword">Confirm password</Label>
              <Input id="confirmPassword" type="password" className="mt-1 h-11 rounded-xl" {...form.register("confirmPassword")} />
              {form.formState.errors.confirmPassword && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.confirmPassword.message}</p>
              )}
            </div>
            {serverError && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{serverError}</div>
            )}
            <Button type="submit" className="h-11 w-full" disabled={resetPassword.isPending}>
              {resetPassword.isPending ? "Updating..." : "Update password"}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
