import { CheckCircle2, Crown, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPlanForBusinessType, PUBLIC_PLAN_ORDER, type BillingCycle, type PlanCode } from "@/features/core/subscription/plans";
import { BUSINESS_TYPE_DEFS, useBusinessTypeKey } from "@/features/core/settings/business-types";
import { useSubscriptionSnapshot } from "@/features/core/subscription/access";
import { PlanBadge, UpgradeModal } from "@/features/core/subscription/components";
import { useState } from "react";
import { PageHeader, PageShell } from "@/components/shared";
import { useLocation } from "wouter";
import { useAppLanguage } from "@/features/core/settings/i18n";

export default function PlansPage() {
  const { snapshot } = useSubscriptionSnapshot();
  const [targetPlan, setTargetPlan] = useState<PlanCode | null>(null);
  const [billingCycle, setBillingCycle] = useState<BillingCycle>("yearly");
  const [, navigate] = useLocation();
  const businessType = useBusinessTypeKey();
  // The trade name and the self-serve copy are translated; the rest of this page
  // is still English and carries its remaining count in the i18n allowlist.
  const { t } = useAppLanguage();

  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Plans"
        description={businessType === "kirana"
          ? `${t(BUSINESS_TYPE_DEFS[businessType].labelKey)} pricing: self-serve software with no setup fee.`
          : `${t(BUSINESS_TYPE_DEFS[businessType].labelKey)} pricing: in-person setup, supported hardware configuration, training, support and software.`}
        actions={snapshot ? <PlanBadge planCode={snapshot.planCode} status={snapshot.status} /> : null}
      />

      {businessType === "kirana" ? (
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-5">
            <p className="font-bold">{t("plans.selfServeTitle")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("plans.selfServeBody")}</p>
          </CardContent>
        </Card>
      ) : <Card className="border-primary/30 bg-primary/5">
        <CardContent className="grid gap-3 p-5 md:grid-cols-4">
          <div><p className="font-bold">One-time shop setup</p><p className="text-2xl font-black">Rs 4,999</p></div>
          <div><p className="font-semibold">Installation</p><p className="text-sm text-muted-foreground">In-person launch and supported hardware setup</p></div>
          <div><p className="font-semibold">Catalog + training</p><p className="text-sm text-muted-foreground">Starter catalog entry and owner/staff training</p></div>
          <div><p className="font-semibold">Ongoing support</p><p className="text-sm text-muted-foreground">First-year service plus the plan below; hardware is quoted for the shop</p></div>
        </CardContent>
      </Card>}

      <div className="flex justify-center">
        <div className="inline-flex rounded-lg border bg-muted/40 p-1" aria-label="Billing cycle">
          <Button size="sm" variant={billingCycle === "monthly" ? "default" : "ghost"} onClick={() => setBillingCycle("monthly")}>Monthly</Button>
          <Button size="sm" variant={billingCycle === "yearly" ? "default" : "ghost"} onClick={() => setBillingCycle("yearly")}>Annual · save up to 28%</Button>
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        {PUBLIC_PLAN_ORDER.map((code) => {
          const plan = getPlanForBusinessType(code, businessType);
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
                  <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-primary">{businessType === "kirana" ? t("plans.softwareSelfServe") : t("plans.softwareBundled")}</p>
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
            <p>Expiry never bricks the counter: sales, billing renewal and data export remain available. Existing bills, customers, products and ledgers remain viewable.</p>
          </div>
        </CardContent>
      </Card>

      <UpgradeModal open={targetPlan !== null} onOpenChange={(open) => !open && setTargetPlan(null)} targetPlanCode={targetPlan ?? undefined} billingCycle={billingCycle} />
    </PageShell>
  );
}
