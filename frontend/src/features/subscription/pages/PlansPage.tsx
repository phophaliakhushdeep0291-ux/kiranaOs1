import { CheckCircle2, Crown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { PLAN_DEFINITIONS, PUBLIC_PLAN_ORDER, type BillingCycle, type PlanCode } from "@/features/subscription/plans";
import { useSubscriptionSnapshot } from "@/features/subscription/access";
import { PlanBadge, UpgradeModal } from "@/features/subscription/components";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/shared";
import { useLocation } from "wouter";

export default function PlansPage() {
  const { snapshot } = useSubscriptionSnapshot();
  const [targetPlan, setTargetPlan] = useState<PlanCode | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [, navigate] = useLocation();

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Plans"
        description="Choose the right plan for your shop. Old data stays viewable even after expiry."
        actions={snapshot ? <PlanBadge planCode={snapshot.planCode} status={snapshot.status} /> : null}
      />

      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1" aria-label="Billing cycle">
          <Button size="sm" variant={billingCycle === "monthly" ? "default" : "ghost"} onClick={() => setBillingCycle("monthly")}>Monthly</Button>
          <Button size="sm" variant={billingCycle === "yearly" ? "default" : "ghost"} onClick={() => setBillingCycle("yearly")}>Annual · save up to 28%</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PUBLIC_PLAN_ORDER.map((code) => {
          const plan = PLAN_DEFINITIONS[code];
          const isCurrent = snapshot?.planCode === code;
          return (
            <Card key={plan.code} className={plan.highlight ? "border-primary shadow-sm" : ""}>
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="flex items-center gap-2">{plan.name}{plan.code === "pro" && <Crown className="h-4 w-4 text-amber-500" />}</CardTitle>
                  {isCurrent ? <Badge>Current</Badge> : plan.highlight ? <Badge variant="secondary">Popular</Badge> : null}
                </div>
                <CardDescription>{plan.headline}</CardDescription>
                <div className="pt-2">
                  <span className="text-3xl font-bold">Rs {billingCycle === "yearly" ? plan.annualPrice : plan.price}</span>
                  <span className="text-sm text-muted-foreground">/{billingCycle === "yearly" ? "year" : "month"}</span>
                  {billingCycle === "yearly" && <p className="mt-1 text-xs text-emerald-700">Rs {Math.round(plan.annualPrice / 12)}/month, billed annually</p>}
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-2 gap-2 text-sm">
                  <div className="rounded-lg bg-muted p-2"><p className="font-medium">{plan.maxStores}</p><p className="text-xs text-muted-foreground">store{plan.maxStores > 1 ? "s" : ""}</p></div>
                  <div className="rounded-lg bg-muted p-2"><p className="font-medium">{plan.maxDevices}</p><p className="text-xs text-muted-foreground">device{plan.maxDevices > 1 ? "s" : ""}</p></div>
                </div>
                <p className="text-xs text-muted-foreground">{plan.maxStaff > 0 ? `Includes ${plan.maxStaff} staff accounts` : "Owner account only"}</p>
                <ul className="space-y-2 text-sm">
                  {plan.bullets.slice(0, 4).map((bullet) => (
                    <li key={bullet} className="flex gap-2"><CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-primary" /><span>{bullet}</span></li>
                  ))}
                </ul>
                {plan.bullets.length > 4 && (
                  <p className="text-xs text-muted-foreground">+{plan.bullets.length - 4} more included</p>
                )}
                <Button className="w-full" variant={isCurrent ? "outline" : "default"} onClick={() => isCurrent ? navigate("/subscription") : setTargetPlan(plan.code)}>{isCurrent ? "Manage current plan" : `Upgrade to ${plan.name}`}</Button>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <Card className="bg-muted/40">
        <CardContent className="p-5 flex gap-3 text-sm text-muted-foreground">
          <ShieldCheck className="h-5 w-5 shrink-0 text-primary" />
          <div>
            <p className="font-medium text-foreground">Data stays yours</p>
            <p>Expired subscription blocks cloud sync and premium actions, but old bills, customers, products, ledger and reports remain viewable locally.</p>
          </div>
        </CardContent>
      </Card>

      <UpgradeModal open={targetPlan !== null} onOpenChange={(open) => !open && setTargetPlan(null)} targetPlanCode={targetPlan ?? undefined} billingCycle={billingCycle} />
    </PageShell>
  );
}
