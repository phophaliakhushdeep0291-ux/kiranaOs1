import { useState } from "react";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { UpgradeModal } from "@/features/subscription/components/UpgradeModal";
import { getRequiredPlanForFeature, type FeatureName, type PlanCode } from "@/features/subscription/plans";

export function UpgradePrompt({ featureName, title, description, compact = false }: { featureName: FeatureName; title?: string; description?: string; compact?: boolean }) {
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
    <Card className="border-dashed bg-muted/30">
      <CardContent className="p-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-semibold flex items-center gap-2"><Lock size={16} />{title ?? `Upgrade to ${plan.name}`}</p>
          <p className="text-sm text-muted-foreground">{description ?? `This action requires the ₹${plan.price} ${plan.name} plan.`}</p>
        </div>
        <Button onClick={() => setOpen(true)}>See upgrade</Button>
      </CardContent>
      <UpgradeModal open={open} onOpenChange={setOpen} targetPlanCode={plan.code as PlanCode} reason={description} />
    </Card>
  );
}
