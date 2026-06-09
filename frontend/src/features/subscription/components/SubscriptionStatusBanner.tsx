import { Link } from "wouter";
import { AlertTriangle, CloudOff, CreditCard, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSubscriptionSnapshot } from "@/features/subscription/access";

export function SubscriptionStatusBanner() {
  const { snapshot, loading } = useSubscriptionSnapshot();
  if (loading || !snapshot) return null;
  if (snapshot.status === "active" && snapshot.cloudSyncAllowed) return null;

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
