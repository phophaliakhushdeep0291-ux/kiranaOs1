import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, CloudOff, CreditCard, Database, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAN_DEFINITIONS, PLAN_ORDER, type PlanCode } from "@/features/subscription/plans";
import { useSubscriptionSnapshot } from "@/features/subscription/access";
import { PlanBadge, UpgradeModal } from "@/features/subscription/components";
import { subscriptionRefreshLocalFirst } from "@/features/subscription/local-actions";
import { useToast } from "@/hooks/use-toast";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/shared";

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

  if (loading || !snapshot) return <PageShell><div className="text-sm text-muted-foreground">Loading subscription...</div></PageShell>;

  const stateIcon = snapshot.isPaymentFailed ? CreditCard : snapshot.isExpired ? CloudOff : snapshot.isTrial || snapshot.graceActive ? AlertTriangle : CheckCircle2;
  const StateIcon = stateIcon;

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Subscription"
        description="Manage plan access, sync permission, and expiry behavior."
        actions={<PlanBadge planCode={snapshot.planCode} status={snapshot.status} />}
      />

      <Card className={snapshot.localOnlyAfterExpiry ? "border-amber-300" : ""}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><StateIcon className="h-5 w-5" />{snapshot.plan.name} - Rs {snapshot.plan.price}/month</CardTitle>
          <CardDescription>{snapshot.message}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          <div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Status</p><p className="font-semibold capitalize">{snapshot.status.replace(/_/g, " ")}</p></div>
          <div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Plan ends</p><p className="font-semibold text-sm">{formatDate(snapshot.currentPeriodEnd)}</p></div>
          <div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Offline grace</p><p className="font-semibold text-sm">{formatDate(snapshot.offlineGraceEndsAt)}</p></div>
          <div className="rounded-lg border p-3"><p className="text-sm text-muted-foreground">Cloud sync</p><Badge variant={snapshot.cloudSyncAllowed ? "default" : "destructive"}>{snapshot.cloudSyncAllowed ? "Allowed" : "Disabled"}</Badge></div>
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

      <div className="flex flex-wrap gap-2">
        <Button onClick={() => setTargetPlan("standard")}>Upgrade plan</Button>
        <Button variant="outline" onClick={() => void refreshSubscription()} disabled={refreshing}><RefreshCcw className="mr-1.5 h-4 w-4" />{refreshing ? "Queuing..." : "Refresh subscription"}</Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Plan limits</CardTitle>
          <CardDescription>Current and higher plans at a glance.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-4">
          {PLAN_ORDER.map((code) => {
            const plan = PLAN_DEFINITIONS[code];
            return (
              <button key={plan.code} onClick={() => setTargetPlan(plan.code)} className={`rounded-lg border p-4 text-left hover:bg-muted ${snapshot.planCode === plan.code ? "border-primary" : ""}`}>
                <div className="flex items-center justify-between"><p className="font-semibold">{plan.name}</p>{snapshot.planCode === plan.code && <Badge>Current</Badge>}</div>
                <p className="mt-1 text-sm text-muted-foreground">Rs {plan.price}/month</p>
                <p className="mt-2 text-xs text-muted-foreground">{plan.maxStores} store - {plan.maxDevices} devices</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <UpgradeModal open={targetPlan !== null} onOpenChange={(open) => !open && setTargetPlan(null)} targetPlanCode={targetPlan ?? undefined} />
    </PageShell>
  );
}
