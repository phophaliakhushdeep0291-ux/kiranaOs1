import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, CheckCircle2, CloudOff, CreditCard, Database, RefreshCcw } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlanForBusinessType, offeredPlanCodes, type PlanCode } from "@/features/core/subscription/plans";
import { useBusinessTypeKey } from "@/features/core/settings/business-types";
import { useSubscriptionSnapshot } from "@/features/core/subscription/access";
import { formatFreeAccessDate, isFreeAccessPresale } from "@/features/core/subscription/free-access";
import { CancelSubscriptionDialog, PlanBadge, UpgradeModal } from "@/features/core/subscription/components";
import { subscriptionRefreshLocalFirst } from "@/features/core/subscription/local-actions";
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
  const businessType = useBusinessTypeKey();
  // What this trade is sold — a restaurant is offered two plans, not three.
  const offeredPlans = offeredPlanCodes(businessType);
  const { snapshot, loading, refresh } = useSubscriptionSnapshot();
  const { language, t } = useAppLanguage();
  const { toast } = useToast();
  const [targetPlan, setTargetPlan] = useState<PlanCode | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  async function refreshSubscription() {
    setRefreshing(true);
    try {
      await subscriptionRefreshLocalFirst(snapshot?.planCode ?? "starter");
      await refresh();
      toast({ title: "Subscription refreshed", description: "Plan and payment status were confirmed by the server." });
    } catch (error) {
      toast({
        title: "Could not refresh subscription",
        description: error instanceof Error ? error.message : "Reconnect and try again.",
        variant: "destructive",
      });
    } finally {
      setRefreshing(false);
    }
  }

  if (loading || !snapshot) return (
    <PageShell className="space-y-5">
      <PageHeader headingLevel={2} title="Subscription" description="Your plan, billing cycle, and store protection in one place." />
      <LoadingSkeleton variant="detail" rows={2} className="rounded-[18px] border border-[#e2eaf5] bg-white p-5" />
    </PageShell>
  );

  const stateIcon = snapshot.isPaymentFailed ? CreditCard : snapshot.isExpired ? CloudOff : snapshot.isTrial || snapshot.graceActive ? AlertTriangle : CheckCircle2;
  const StateIcon = stateIcon;

  // While the launch promotion runs there is nothing to buy or cancel: checkout is
  // refused, and a shop's own paid period carries on underneath untouched.
  const freeDate = snapshot.freeAccessUntil ? formatFreeAccessDate(snapshot.freeAccessUntil, language) : null;
  // In the promotion's last month plans are on sale again, dated from the day the
  // window shuts. Access itself does not change: it is free until then either way.
  const presale = isFreeAccessPresale(snapshot.freeAccessUntil);

  // Only a paid, active plan can be cancelled (trials/expired/grace have nothing to cancel).
  const canCancel = !freeDate && snapshot.status === "active";
  const publicCurrentIndex = offeredPlans.indexOf(snapshot.planCode as (typeof offeredPlans)[number]);
  const currentIndex = snapshot.planCode === "standard" ? 0 : Math.max(0, publicCurrentIndex);
  const nextPlan = snapshot.planCode === "standard"
    ? "growth"
    : currentIndex < offeredPlans.length - 1 ? offeredPlans[currentIndex + 1] : null;
  /**
   * A lapsed plan always gets a way to pay, as the first thing in the row.
   *
   * The row was built from two optional buttons — upgrade, when a higher plan
   * exists, and cancel, when the plan is active — so a shop on the top plan whose
   * subscription had expired got neither, and was left with "Check payment
   * status" as its only control. Renewing meant finding the small "tap to renew"
   * line inside the comparison grid below. Grace belongs here too: the period has
   * ended, and paying before grace runs out is the whole point of having one.
   *
   * Only a plan this trade is still sold can be renewed as itself. A legacy one
   * moves to its replacement through "Compare and upgrade", which then leads the
   * row — a "Renew Growth" button for a shop that never had Growth, opening a
   * dialog titled "Upgrade to Growth", would have been two names for one step.
   */
  const needsRenewal = snapshot.isExpired || snapshot.isPaymentFailed || snapshot.graceActive;
  // Nothing is owed while the launch promotion runs, so there is nothing to renew.
  const showRenew = !freeDate && needsRenewal && (offeredPlans as readonly PlanCode[]).includes(snapshot.planCode);
  const periodEndLabel = snapshot.currentPeriodEnd ? new Date(snapshot.currentPeriodEnd).toLocaleDateString("en-IN") : null;
  const planMessage = freeDate
    ? presale
      ? t("plans.free.presaleBody", { date: freeDate })
      : t("plans.free.modalBody", { date: freeDate, plan: snapshot.plan.name })
    : snapshot.status === "active" && snapshot.cloudSyncAllowed
    ? `Your ${snapshot.plan.name} features are ready and this device is protected.`
    : snapshot.message;

  return (
    <PageShell className="app-data-reveal space-y-5">
      <PageHeader
        headingLevel={2}
        title="Subscription"
        description="Your plan, billing cycle, and store protection in one place."
        actions={<PlanBadge planCode={snapshot.planCode} status={snapshot.status} plan={snapshot.plan} freeAccessUntil={snapshot.freeAccessUntil} />}
      />

      <Card className={`overflow-hidden rounded-[18px] shadow-[0_16px_42px_rgba(16,35,71,0.08)] ${snapshot.localOnlyAfterExpiry ? "border-amber-300" : "border-[#d7e3f3]"}`}>
        <CardHeader className="border-b border-[#dbe7f7] bg-[linear-gradient(135deg,var(--brand-softer)_0%,var(--brand-soft)_100%)] p-5 sm:p-6">
          <p className="text-[11px] font-black uppercase tracking-[0.16em] text-[var(--brand)]">Current plan</p>
          <div className="flex flex-wrap items-end justify-between gap-3">
            <CardTitle className="flex items-center gap-2.5 font-display text-2xl font-black tracking-tight text-[var(--brand-ink)]">
              <span className="grid h-9 w-9 place-items-center rounded-xl bg-white text-[var(--brand)] shadow-sm ring-1 ring-[#d8e5fa]"><StateIcon className="h-5 w-5" /></span>
              {snapshot.plan.name}
            </CardTitle>
            {freeDate
              ? <p className="font-display text-2xl font-black tracking-tight text-emerald-700">{t("plans.free.label")}</p>
              : <p className="font-display text-2xl font-black tracking-tight text-[var(--brand-ink)]">₹{snapshot.plan.price}<span className="text-sm font-semibold text-[#66758d]">/month</span></p>}
          </div>
          <CardDescription className="max-w-2xl text-sm leading-6 text-[#536383]">{planMessage}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 p-4 sm:p-5 md:grid-cols-4">
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Plan status</p><p className="mt-1 font-bold capitalize text-[var(--brand-ink)]">{freeDate ? t("plans.free.label") : snapshot.status.replace(/_/g, " ")}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Access until</p><p className="mt-1 text-sm font-bold text-[var(--brand-ink)]">{formatDate(snapshot.currentPeriodEnd)}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Offline protection</p><p className="mt-1 text-sm font-bold text-[var(--brand-ink)]">{formatDate(snapshot.offlineGraceEndsAt)}</p></div>
          <div className="rounded-[13px] border border-[#e0e8f3] bg-[#fbfcfe] p-3.5"><p className="text-xs font-semibold text-muted-foreground">Automatic backup</p><Badge className="mt-1" variant={snapshot.cloudSyncAllowed ? "default" : "destructive"}>{snapshot.cloudSyncAllowed ? "Protected" : "Paused"}</Badge></div>
        </CardContent>
      </Card>

      {snapshot.localOnlyAfterExpiry && (
        <Card className="border-amber-300 bg-amber-50">
          <CardContent className="p-4 flex gap-3 text-sm text-amber-900">
            <Database className="h-5 w-5 shrink-0" />
            {/* This card used to close with "New billing may be restricted after
                offline grace ends". Nothing restricts it: canCreateNewBills never
                reads expiry, on purpose, because a counter that cannot sell is
                worse than any unpaid invoice. A shop was being warned it might
                lose the till over a rule that does not exist. */}
            <div>
              <p className="font-semibold">{t("plans.lapsed.title")}</p>
              <p>{t(snapshot.graceActive ? "plans.grace.body" : "plans.lapsed.body")}</p>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid gap-2 sm:flex sm:flex-wrap">
        {showRenew && (
          <Button className="h-11 rounded-xl px-5 font-bold shadow-[0_10px_24px_rgba(7,95,255,0.2)]" onClick={() => setTargetPlan(snapshot.planCode)}>
            <CreditCard className="mr-1.5 h-4 w-4" />{t("plans.renew", { plan: snapshot.plan.name })}
          </Button>
        )}
        {nextPlan && (!freeDate || presale) && <Button variant={showRenew ? "outline" : "default"} className={`h-11 rounded-xl px-5 font-bold ${showRenew ? "" : "shadow-[0_10px_24px_rgba(7,95,255,0.2)]"}`} onClick={() => setTargetPlan(nextPlan)}>Compare and upgrade</Button>}
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
          {freeDate && !presale
            ? <CardDescription>{t("plans.free.compareBody", { date: freeDate })}</CardDescription>
            : <CardDescription>Choose the capacity that matches how your store works.</CardDescription>}
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-3">
          {offeredPlans.map((code, index) => {
            const plan = getPlanForBusinessType(code, businessType);
            const isCurrent = snapshot.planCode === plan.code;
            const isHigher = index > currentIndex;
            // Clicking the plan you already have shouldn't try to sell it back to you:
            // if it's active, offer to cancel; otherwise start checkout to renew/switch.
            const handleClick = () => (isCurrent && canCancel ? setCancelOpen(true) : setTargetPlan(plan.code));
            const hint = freeDate && presale
              ? t("plans.free.startsOn", { date: freeDate })
              : freeDate
                ? t("plans.free.title", { date: freeDate })
                : isCurrent
                  ? canCancel ? "Active - tap to cancel" : "Current plan - tap to renew"
                  : isHigher ? "Tap to upgrade" : "Tap to switch";
            return (
              <button key={plan.code} onClick={handleClick} disabled={Boolean(freeDate && !presale)} className={`rounded-[14px] border p-4 text-left transition-all hover:-translate-y-0.5 hover:shadow-md disabled:pointer-events-none ${isCurrent ? "border-primary bg-[#f3f7ff] ring-1 ring-primary/15" : "border-[#e0e8f3] hover:bg-muted"}`}>
                <div className="flex items-center justify-between"><p className="font-semibold">{plan.name}</p>{isCurrent && <Badge>Current</Badge>}</div>
                <p className="mt-1 text-sm font-bold text-[var(--brand-ink)]">₹{plan.price}<span className="font-medium text-muted-foreground">/month</span></p>
                <p className="mt-2 text-xs text-muted-foreground">{plan.maxStores} store · {plan.maxDevices} devices · {plan.maxStaff || "no"} staff</p>
                <p className={`mt-2 text-xs font-medium ${isCurrent ? "text-primary" : "text-muted-foreground"}`}>{hint}</p>
              </button>
            );
          })}
        </CardContent>
      </Card>

      <UpgradeModal
        open={targetPlan !== null}
        onOpenChange={(open) => !open && setTargetPlan(null)}
        targetPlanCode={targetPlan ?? undefined}
        mode={targetPlan !== null && targetPlan === snapshot.planCode ? "renew" : "upgrade"}
      />
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
