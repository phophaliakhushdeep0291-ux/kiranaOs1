import { useState } from "react";
import { ArrowRight, CheckCircle2, Lock, Sparkles } from "lucide-react";
import { Link } from "wouter";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UpgradeModal } from "@/features/core/subscription/components/UpgradeModal";
import { getRequiredPlanForFeature, type FeatureName, type PlanCode } from "@/features/core/subscription/plans";
import { useAppLanguage } from "@/features/core/settings/i18n";

export function UpgradePrompt({ featureName, title, description, compact = false }: { featureName: FeatureName; title?: string; description?: string; compact?: boolean }) {
  const { t } = useAppLanguage();
  const [open, setOpen] = useState(false);
  const plan = getRequiredPlanForFeature(featureName);
  if (compact) {
    return (
      <>
        <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Lock size={14} className="mr-1.5" />Upgrade to {plan.name}</Button>
        <UpgradeModal open={open} onOpenChange={setOpen} targetPlanCode={plan.code as PlanCode} reason={description} />
      </>
    );
  }
  return (
    <Card className="relative mx-auto my-6 w-[calc(100%-2rem)] max-w-3xl overflow-hidden rounded-[24px] border-[var(--brand-border)] bg-[radial-gradient(circle_at_top_right,var(--brand-soft)_0,transparent_42%),linear-gradient(145deg,#ffffff_0%,#f8fbff_100%)] shadow-[0_24px_70px_rgba(15,35,80,0.10)] sm:my-10">
      <div className="pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full border-[28px] border-[var(--brand-soft)] opacity-70" aria-hidden="true" />
      <CardContent className="relative p-6 sm:p-8">
        <div className="inline-flex items-center gap-2 rounded-full border border-[var(--brand-border)] bg-white/90 px-3 py-1.5 text-[11px] font-black uppercase tracking-[0.12em] text-[var(--brand)]">
          <Sparkles size={14} aria-hidden="true" /> Plan-protected workspace
        </div>
        <div className="mt-5 flex flex-col gap-5 sm:flex-row sm:items-start">
          <div className="grid h-14 w-14 shrink-0 place-items-center rounded-[18px] bg-[var(--brand)] text-white shadow-[0_14px_30px_var(--brand-shadow)]">
            <Lock size={24} aria-hidden="true" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-2xl font-black tracking-tight text-[var(--brand-ink)] sm:text-[30px]">{title ?? `Unlock ${plan.name}`}</h2>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">{description ?? `This workspace is included in the ₹${plan.price} ${plan.name} plan.`}</p>
            <div className="mt-5 grid gap-2 text-sm font-semibold text-[#405273] sm:grid-cols-3">
              {["Monthly or yearly", "No surprise activation", "Keep your current data"].map((benefit) => (
                <span key={benefit} className="flex items-center gap-2"><CheckCircle2 size={16} className="shrink-0 text-emerald-600" aria-hidden="true" />{benefit}</span>
              ))}
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Button onClick={() => setOpen(true)} className="h-11 rounded-xl px-5 font-black shadow-[0_10px_24px_var(--brand-shadow)]">Compare {plan.name} options <ArrowRight size={16} aria-hidden="true" /></Button>
              <Link href="/plans" className="inline-flex min-h-11 items-center justify-center rounded-xl px-4 text-sm font-black text-[var(--brand)] hover:bg-[var(--brand-soft)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand)]">{t("plans.viewAll")}</Link>
            </div>
          </div>
        </div>
      </CardContent>
      <UpgradeModal open={open} onOpenChange={setOpen} targetPlanCode={plan.code as PlanCode} reason={description} />
    </Card>
  );
}
