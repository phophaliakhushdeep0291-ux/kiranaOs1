import SubscriptionPage from "@/features/subscription/pages/SubscriptionPage";
import { FramedSettingsPage } from "@/features/settings/SettingsShell";

/** Billing & Subscription tab — frames the existing subscription page in the Settings shell. */
export default function BillingSettingsPage() {
  return (
    <FramedSettingsPage>
      <SubscriptionPage />
    </FramedSettingsPage>
  );
}
