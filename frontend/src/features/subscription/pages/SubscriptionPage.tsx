import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, CloudOff, CreditCard, Database, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAN_DEFINITIONS, PUBLIC_PLAN_ORDER, type PlanCode } from "@/features/subscription/plans";
import { useSubscriptionSnapshot } from "@/features/subscription/access";
import { CancelSubscriptionDialog, PlanBadge, UpgradeModal } from "@/features/subscription/components";
import { subscriptionRefreshLocalFirst } from "@/features/subscription/local-actions";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { LoadingSkeleton, PageHeader, PageShell } from "@/components/shared";

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "Not available";
  return `${date.toLocaleDateString("en-IN")} (${formatDistanceToNow(date, { addSuffix: true })})`;
}

export default function SubscriptionPage() {
  const { snapshot, loading, refresh } = useSubscriptionSnapshot();
  const { toast } = useToast();
  const [targetPlan, setTargetPlan] = useState<PlanCode | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshSubscription() {
    setRefreshing(true);
    try {
      await subscriptionRefreshLocalFirst(snapshot?.planCode ?? "starter");
      await refresh();
      toast({ title: "Subscription refresh queued", description: "It will sync when cloud backup is allowed and internet is available." });
    } finally {
      setRefreshing(false);
    }
  }

  if (loading || !snapshot) return (
    <PageShell className="space-y-5">
      <PageHeader title="Subscription" description="Your plan, billing cycle, and store protection in one place." />
      <LoadingSkeleton variant="detail" rows={2} className="rounded-[18px] border border-[#e2eaf5] bg-white p-5" />
    </PageShell>
  );

  const stateIcon = snapshot.isPaymentFailed ? CreditCard : snapshot.isExpired ? CloudOff : snapshot.isTrial || snapshot.graceActive ? AlertTriangle : CheckCircle2;
  const StateIcon = stateIcon;

  // Only a paid, active plan can be cancelled (trials/expired/grace have nothing to cancel).
  const canCancel = snapshot.status === "active";
  const publicCurrentIndex = PUBLIC_PLAN_ORDER.indexOf(snapshot.planCode as (typeof PUBLIC_PLAN_ORDER)[number]);
  const currentIndex = snapshot.planCode === "standard" ? 0 : Math.max(0, publicCurrentIndex);
  const nextPlan = snapshot.planCode === "standard"
    ? "growth"
    : currentIndex < PUBLIC_PLAN_ORDER.length - 1 ? PUBLIC_PLAN_ORDER[currentIndex + 1] : null;
  const periodEndLabel = snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd).toLocaleDateString("en-IN") : null;
  const planMessage = snapshot.status === "active" && snapshot.cloudSyncAllowed
    ? `Your ${snapshot.plan.name} features are ready and this device is protected.`
    : snapshot.message;

  return (
    <PageShell className="app-data-reveal space-y-5">
      <PageHeader
        title="Subscription"
        description="Your plan, billing cycle, and store protection in one place."
        actions={<PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}
      />

      <Card className={`overflow-hidden rounded-[18px] shadow-[0_16px_42px_rgba(16,35,71,0.08)] ${snapshot.localOnlyAfterExpiry ? "border-amber-300" : "border-[#d7e3f3]"}`}>
        <CardHeader className="border-b border-[#dbe7f7] bg-[linear-gradient(135deg,#f7faff_0%,#edf4ff_100%)] p-5 sm:p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[#075fff]">Current plan</p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle className="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-[#102347]">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[#075fff] shadow-sm ring-1 ring-[#d8e5fa]"><StateIcon className="h-5 w-5" /></span>
              {snapshot.plan.name}
            </CardTitle>
            <p className="font-display text-2xl font-black tracking-tight text-[#102347]">₹{snapshot.plan.price}<span className="text-sm font-semibold text-[#66758d]">/month</span></p>
          </div>
          <CardDescription className="max-w-2xl text-sm leading-6 text-[#536383]">{planMessage}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:p-5 md:grid-cols-4">
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Plan status</p><p className="mt-1 font-bold capitalize text-[#102347]">{snapshot.status.replace(/_/g, " ")}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Access until</p><p className="mt-1 text-sm font-bold text-[#102347]">{formatDate(snapshot.currentPeriodEnd)}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Offline protection</p><p className="mt-1 text-sm font-bold text-[#102347]">{formatDate(snapshot.offlineGraceEndsAt)}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Automatic backup</p><Badge className="mt-1" variant={snapshot.cloudSyncAllowed ? "default" : "destructive"}>{snapshot.cloudSyncAllowed ? "Protected" : "Paused"}</Badge></div>
        </CardContent>
      </Card>

      {snapshot.localOnlyAfterExpiry && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 flex gap-3 text-sm text-amber-900">
            <Database className="h-5 w-5 shrink-0" />
            <div>
              <p className="font-semibold">Local-only warning after expiry</p>
              <p>Old data remains viewable. Cloud sync and premium actions are blocked until renewal. New billing may be restricted after offline grace ends.</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {nextPlan && <Button className="h-11 rounded-xl px-5 font-bold shadow-[0_10px_24px_rgba(7,95,255,0.2)]" onClick={() => setTargetPlan(nextPlan)}>Compare and upgrade</Button>}
        {canCancel && (
          <Button variant="outline" className="h-11 rounded-xl text-destructive hover:text-destructive" onClick={() => setCancelOpen(true)}>
            Cancel plan
          </Button>
        )}
        <Button variant="ghost" className="h-11 rounded-xl text-[#536383]" onClick={() => void refreshSubscription()} disabled={refreshing}><RefreshCcw className="mr-1.5 h-4 w-4" />{refreshing ? "Checking..." : "Check payment status"}</Button>
      </div>

      <Card className="rounded-[18px] border-[#dce5f2]">
        <CardHeader>
          <CardTitle className="font-display text-xl font-black tracking-tight">Compare plans</CardTitle>
          <CardDescription>Choose the capacity that matches how your store works.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {PUBLIC_PLAN_ORDER.map((code, index) => {
            const plan = PLAN_DEFINITIONS[code];
            const isCurrent = snapshot.planCode === plan.code;
            const isHigher = index > currentIndex;
            // Clicking the plan you already have shouldn't try to sell it back to you:
            // if it's active, offer to cancel; otherwise start checkout to renew/switch.
            const handleClick = () => (isCurrent && canCancel ? setCancelOpen(true) : setTargetPlan(plan.code));
            const hint = isCurrent
              ? canCancel ? "Active - tap to cancel" : "Current plan - tap to renew"
              : isHigher ? "Tap to upgrade" : "Tap to switch";
            return (
              <button key={plan.code} onClick={handleClick} className={`rounded-[14px] border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md ${isCurrent ? "border-primary bg-[#f3f7ff] ring-1 ring-primary/15" : "border-[#e0e8f3] hover:bg-muted"}`}>
                <div className="flex items-center justify-between"><p className="font-semibold">{plan.name}</p>{isCurrent && <Badge>Current</Badge>}</div>
                <p className="mt-1 text-sm font-bold text-[#102347]">₹{plan.price}<span className="font-medium text-muted-foreground">/month</span></p>
                <p className="mt-2 text-xs text-muted-foreground">{plan.maxStores} store · {plan.maxDevices} devices · {plan.maxStaff || "no"} staff</p>
                <p className={`mt-2 text-xs font-medium ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>{hint}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <UpgradeModal open={targetPlan !== null} onOpenChange={(open) => !open && setTargetPlan(null)} targetPlanCode={targetPlan ?? undefined} />
      <CancelSubscriptionDialog
        open={cancelOpen}
        onOpenChange={setCancelOpen}
        planName={snapshot.plan.name}
        periodEndLabel={periodEndLabel}
        onCancelled={refresh}
      />
    </PageShell>
  );
}
