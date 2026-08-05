import { useState } from "react";
import { Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { MailCheck, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useForgotPassword } from "@/features/core/auth/queries";

const schema = z.object({
  identifier: z.string().min(3, "Enter your mobile number or email"),
});

type FormData = z.infer<typeof schema>;

export default function ForgotPasswordPage() {
  const [sent, setSent] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const form = useForm<FormData>({
    resolver: zodResolver(schema),
    defaultValues: { identifier: "" },
  });
  const forgotPassword = useForgotPassword({
    mutation: {
      onSuccess: () => {
        setSent(true);
        setServerError(null);
      },
      onError: (error) => {
        setServerError(error.message || "Could not start password recovery");
      },
    },
  });

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 shadow-xl">
        <div className="mb-6">
          <div className="mb-4 inline-flex h-12 w-12 items-center justify-center rounded-xl bg-primary text-primary-foreground">
            {sent ? <MailCheck size={24} /> : <Store size={24} />}
          </div>
          <h1 className="text-2xl font-black text-foreground">Recover password</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Enter your Gmail/email or mobile number. If recovery is available, we will send a secure reset link.
          </p>
        </div>

        {sent ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-800">
              Check your email for the reset link. The link expires shortly for safety.
            </div>
            <Button asChild className="h-11 w-full">
              <Link href="/login">Back to sign in</Link>
            </Button>
          </div>
        ) : (
          <form
            className="space-y-4"
            onSubmit={form.handleSubmit((values) => forgotPassword.mutate({ data: values }))}
          >
            <div>
              <Label htmlFor="identifier">Mobile number or email</Label>
              <Input
                id="identifier"
                data-testid="input-recovery-identifier"
                className="mt-1 h-11 rounded-xl"
                placeholder="Enter mobile or email"
                {...form.register("identifier")}
              />
              {form.formState.errors.identifier && (
                <p className="mt-1 text-xs text-destructive">{form.formState.errors.identifier.message}</p>
              )}
            </div>
            {serverError && (
              <div className="rounded-xl bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {serverError}
              </div>
            )}
            <Button type="submit" className="h-11 w-full" disabled={forgotPassword.isPending}>
              {forgotPassword.isPending ? "Sending..." : "Send reset link"}
            </Button>
            <p className="text-center text-sm text-muted-foreground">
              Remembered it?{" "}
              <Link
                href="/login"
                className="inline-flex min-h-[44px] cursor-pointer items-center px-1 align-middle font-semibold text-primary hover:underline"
              >
                Sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
