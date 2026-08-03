import type { ReactNode } from "react";
import { UpgradePrompt } from "@/features/core/subscription/components/UpgradePrompt";
import { useFeature } from "@/features/core/subscription/access";
import type { FeatureName } from "@/features/core/subscription/plans";

export function FeatureGate({ featureName, children, fallback }: { featureName: FeatureName; children: ReactNode; fallback?: ReactNode }) {
  const feature = useFeature(featureName);
  if (feature.loading) return null;
  if (feature.allowed) return <>{children}</>;
  return <>{fallback ?? <UpgradePrompt featureName={featureName} description={feature.reason} />}</>;
}
