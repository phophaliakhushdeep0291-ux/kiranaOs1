import { ArrowRight, Brain, CalendarCheck, Cloud, MessageCircle, Mic, RotateCcw, Search, ShieldAlert, Sparkles, WalletCards } from "lucide-react";
import { Link } from "wouter";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { UpgradePrompt, useFeature } from "@/features/subscription";
import { FEATURE_LABELS, getRequiredPlanForFeature, type FeatureName } from "@/features/subscription/plans";
import { INNOVATION_FEATURES, type InnovationFeature } from "@/features/innovation/architecture";
import { OfflineConfidenceMeter } from "@/features/innovation/components/OfflineConfidenceMeter";
import { PageHeader, PageShell } from "@/components/shared";

const iconById: Record<string, typeof Mic> = {
  "voice-billing": Mic,
  "whatsapp-reminders": MessageCircle,
  "smart-daily-closing": CalendarCheck,
  "customer-trust-score": Brain,
  "smart-price-memory": WalletCards,
  "no-barcode-fast-billing": Search,
  "offline-confidence-meter": Cloud,
  "recovery-mode": RotateCcw,
};

const statusLabel: Record<InnovationFeature["status"], string> = {
  available: "Available now",
  architecture_ready: "Architecture ready",
  backend_required: "Backend required",
  future: "Future module",
};

function FeatureAccessBadge({ featureName }: { featureName: FeatureName }) {
  const feature = useFeature(featureName);
  if (feature.loading) return <Badge variant="outline">Checking plan...</Badge>;
  return <Badge variant={feature.allowed ? "secondary" : "outline"}>{feature.allowed ? "Included in your plan" : `Upgrade to ${getRequiredPlanForFeature(featureName).name}`}</Badge>;
}

function InnovationCard({ feature }: { feature: InnovationFeature }) {
  const Icon = iconById[feature.id] ?? Sparkles;
  const access = useFeature(feature.featureName);
  return (
    <Card className="flex h-full flex-col overflow-hidden">
      <CardHeader>
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <div className="rounded-lg bg-primary/10 p-3 text-primary"><Icon className="h-5 w-5" /></div>
            <div>
              <CardTitle className="text-lg">{feature.title}</CardTitle>
              <CardDescription>{feature.hindiLabel}</CardDescription>
            </div>
          </div>
          <Badge variant={feature.status === "available" ? "secondary" : "outline"}>{statusLabel[feature.status]}</Badge>
        </div>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col gap-4">
        <p className="text-sm text-muted-foreground">{feature.summary}</p>
        <div className="flex flex-wrap gap-2">
          <FeatureAccessBadge featureName={feature.featureName} />
          <Badge variant="outline">{FEATURE_LABELS[feature.featureName] ?? feature.featureName}</Badge>
        </div>
        {!access.loading && !access.allowed && (
          <UpgradePrompt compact featureName={feature.featureName} description={feature.planNote} />
        )}
        <div className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t pt-3">
          <span className="text-xs text-muted-foreground">{feature.planNote}</span>
          <Link href={feature.entryHref}>
            <Button size="sm" variant={access.allowed ? "default" : "outline"}>
              Open entry point <ArrowRight className="ml-2 h-4 w-4" />
            </Button>
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SmartToolsPage() {
  return (
    <PageShell className="space-y-5">
      <PageHeader
        title="Smart tools"
        description="Premium helpers for faster billing, recovery, reminders, and owner confidence."
        actions={<Link href="/billing"><Button>Fast billing</Button></Link>}
      />

      <Alert>
        <ShieldAlert className="h-4 w-4" />
        <AlertTitle>Production readiness</AlertTitle>
        <AlertDescription>
          Available tools work with saved local data. Items marked for upgrade or backend support stay clearly labeled.
        </AlertDescription>
      </Alert>

      <OfflineConfidenceMeter />

      <div className="grid gap-4">
        {INNOVATION_FEATURES.map((feature) => <InnovationCard key={feature.id} feature={feature} />)}
      </div>
    </PageShell>
  );
}
