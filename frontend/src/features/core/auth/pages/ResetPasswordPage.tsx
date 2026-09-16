import { useMemo, useState } from "react";
import { Link, useLocation } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { resetPasswordSchema as schema, authValidationKey } from "@/features/core/auth/form-schemas";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { LanguageToggle } from "@/features/core/settings/LanguageToggle";
import { KeyRound } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useResetPassword } from "@/features/core/auth/queries";

type FormData = z.infer<typeof schema>;

export default function ResetPasswordPage() {
  const { t } = useAppLanguage();
  const [, setLocation] = useLocation();
  const [success, setSuccess] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return (new URLSearchParams(window.location.search).get("token") || "").trim();
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
      onError: (error) => setServerError(error.message || t("auth.resetFailed")),
    },
  });

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-4 flex justify-end"><LanguageToggle className="mt-0" /></div>
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            <KeyRound size={24} />
          </div>
          <h1 className="text-2xl font-black text-foreground">{t("auth.resetTitle")}</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            {t("auth.resetDescription")}
          </p>
        </div>

        {!token ? (
          <div className="space-y-4">
            <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
              {t("auth.resetMissingToken")}
            </div>
            <Button asChild className="h-11 w-full">
              <Link href="/forgot-password">{t("auth.requestReset")}</Link>
            </Button>
          </div>
        ) : success ? (
          <div className="space-y-4">
            <div role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              {t("auth.resetSuccess")}
            </div>
            <Button type="button" className="h-11 w-full" onClick={() => setLocation("/login")}>
              {t("auth.signIn")}
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => { setServerError(null); resetPassword.mutate({ data: { token, newPassword: values.newPassword } }); })}
          >
            <div>
              <Label htmlFor="newPassword">{t("auth.newPassword")}</Label>
              <Input id="newPassword" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.newPassword)} aria-describedby={form.formState.errors.newPassword ? "newPassword-error" : undefined} className="mt-1 h-11 rounded-xl" {...form.register("newPassword")} />
              {form.formState.errors.newPassword && (
                <p id="newPassword-error" role="alert" className="mt-1 text-xs text-destructive">{t(authValidationKey(form.formState.errors.newPassword.message))}</p>
              )}
            </div>
            <div>
              <Label htmlFor="confirmPassword">{t("auth.confirmPassword")}</Label>
              <Input id="confirmPassword" type="password" autoComplete="new-password" aria-invalid={Boolean(form.formState.errors.confirmPassword)} aria-describedby={form.formState.errors.confirmPassword ? "confirmPassword-error" : undefined} className="mt-1 h-11 rounded-xl" {...form.register("confirmPassword")} />
              {form.formState.errors.confirmPassword && (
                <p id="confirmPassword-error" role="alert" className="mt-1 text-xs text-destructive">{t(authValidationKey(form.formState.errors.confirmPassword.message))}</p>
              )}
            </div>
            {serverError && (
              <div role="alert" className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">{serverError}</div>
            )}
            <Button type="submit" className="h-11 w-full" disabled={resetPassword.isPending}>
              {resetPassword.isPending ? t("auth.updatingPassword") : t("auth.updatePassword")}
            </Button>
          </form>
        )}
      </div>
    </div>
  );
}
