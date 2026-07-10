import { useEffect, useMemo, useState } from "react";
import { Link } from "wouter";
import { MailCheck, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useVerifyEmail } from "@/features/auth/queries";

export default function VerifyEmailPage() {
  const [started, setStarted] = useState(false);
  const token = useMemo(() => {
    if (typeof window === "undefined") return "";
    return new URLSearchParams(window.location.search).get("token") || "";
  }, []);
  const verifyEmail = useVerifyEmail();

  useEffect(() => {
    if (!token || started) return;
    setStarted(true);
    verifyEmail.mutate({ data: { token } });
  }, [started, token, verifyEmail]);

  const success = verifyEmail.isSuccess;
  const error = !token || verifyEmail.isError;

  return (
    <div className="app-shell flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md rounded-2xl border bg-card p-6 text-center shadow-xl">
        <div className={`mx-auto mb-4 inline-flex h-14 w-14 items-center justify-center rounded-xl ${success ? "bg-emerald-100 text-emerald-700" : error ? "bg-destructive/10 text-destructive" : "bg-primary/10 text-primary"}`}>
          {error ? <ShieldAlert size={26} /> : <MailCheck size={26} />}
        </div>
        <h1 className="text-2xl font-black text-foreground">
          {success ? "Email verified" : error ? "Verification failed" : "Verifying email..."}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {success
            ? "Your KiranaOS email is verified. You can use it for safer account recovery."
            : error
              ? "This verification link is invalid or expired. Please request a new link from sign in."
              : "Please wait while we confirm your email."}
        </p>
        <Button asChild className="mt-6 w-full">
          <Link href="/login">Back to sign in</Link>
        </Button>
      </div>
    </div>
  );
}
