import SubscriptionPage from "@/features/core/subscription/pages/SubscriptionPage";
import { FramedSettingsPage } from "@/features/core/settings/SettingsShell";

/** Billing & Subscription tab — frames the existing subscription page in the Settings shell. */
export default function BillingSettingsPage() {
  return (
    <FramedSettingsPage>
      <SubscriptionPage />
    </FramedSettingsPage>
  );
}
