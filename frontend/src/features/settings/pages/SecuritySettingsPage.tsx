import { Shield } from "lucide-react";
import { SettingsPlaceholder } from "@/features/settings/SettingsShell";

export default function SecuritySettingsPage() {
  return (
    <SettingsPlaceholder
      title="Security & PIN"
      icon={<Shield size={26} />}
      blurb="Protect money-sensitive actions with the owner PIN, session locks and an action-approval matrix."
      sections={["Owner PIN", "Session & Login Security", "Sensitive Action Protection", "Trusted Devices", "Security Logs"]}
    />
  );
}
