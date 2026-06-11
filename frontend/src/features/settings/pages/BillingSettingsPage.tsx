import SubscriptionPage from "@/features/subscription/pages/SubscriptionPage";
import { SettingsShell } from "@/features/settings/SettingsShell";

/** Billing & Subscription tab — frames the existing subscription page in the Settings shell. */
export default function BillingSettingsPage() {
  return (
    <SettingsShell>
      <SubscriptionPage />
    </SettingsShell>
  );
}
