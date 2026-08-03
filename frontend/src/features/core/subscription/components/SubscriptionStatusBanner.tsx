import { Link } from "wouter";
import { AlertTriangle, Clock, CloudOff, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionSnapshot } from "@/features/core/subscription/access";

const DAY_MS = 24 * 60 * 60 * 1000;
const TRIAL_WARN_DAYS = 3;

function trialDaysLeft(trialEndsAt: string | null): number | null {
  if (!trialEndsAt) return null;
  const msLeft = new Date(trialEndsAt).getTime() - Date.now();
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / DAY_MS);
}

export function SubscriptionStatusBanner() {
  const { snapshot, loading } = useSubscriptionSnapshot();
  if (loading || !snapshot) return null;

  const daysLeft = snapshot.isTrial ? trialDaysLeft(snapshot.trialEndsAt) : null;
  const showTrialWarning = snapshot.isTrial && snapshot.status === "trial" && daysLeft !== null && daysLeft <= TRIAL_WARN_DAYS;

  if (snapshot.status === "active" && snapshot.cloudSyncAllowed && !showTrialWarning) return null;

  if (showTrialWarning && snapshot.status === "trial" && snapshot.cloudSyncAllowed) {
    const label = daysLeft === 0 ? "Trial ends today" : daysLeft === 1 ? "1 day left in trial" : `${daysLeft} days left in trial`;
    return (
      <div className="border-b bg-amber-50 px-4 py-2 text-amber-800">
        <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
          <div className="flex items-center gap-2">
            <Clock size={16} />
            <span>{label} — upgrade to keep your data synced across devices.</span>
          </div>
          <Link href="/plans"><Button size="sm" variant="outline">See plans</Button></Link>
        </div>
      </div>
    );
  }

  const isDanger = snapshot.isExpired || snapshot.isPaymentFailed;
  const Icon = snapshot.cloudSyncAllowed ? ShieldCheck : snapshot.isPaymentFailed ? CreditCard : CloudOff;
  return (
    <div className={`border-b px-4 py-2 ${isDanger ? "bg-destructive/10 text-destructive" : "bg-amber-50 text-amber-800"}`}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <div className="flex items-center gap-2">
          {snapshot.graceActive ? <AlertTriangle size={16} /> : <Icon size={16} />}
          <span>{snapshot.message}</span>
          {snapshot.localOnlyAfterExpiry && <span className="font-medium">Local-only mode: old data remains viewable.</span>}
        </div>
        <Link href="/subscription"><Button size="sm" variant={isDanger ? "destructive" : "outline"}>Manage subscription</Button></Link>
      </div>
    </div>
  );
}
