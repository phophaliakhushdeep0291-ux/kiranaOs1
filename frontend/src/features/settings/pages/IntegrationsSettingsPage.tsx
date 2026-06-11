import { Plug } from "lucide-react";
import { SettingsPlaceholder } from "@/features/settings/SettingsShell";

export default function IntegrationsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Integrations"
      icon={<Plug size={26} />}
      blurb="Connect WhatsApp, Tally, payment apps, cloud backup and more — plus API access for Pro."
      sections={["Connected Apps Overview", "Integration Cards", "API & Webhooks", "Integration Activity"]}
    />
  );
}
