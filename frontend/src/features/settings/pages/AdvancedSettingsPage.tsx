import { Sliders } from "lucide-react";
import { SettingsPlaceholder } from "@/features/settings/SettingsShell";

export default function AdvancedSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Advanced"
      icon={<Sliders size={26} />}
      blurb="Data tools, app preferences, import/export, offline database repair, diagnostics and the danger zone."
      sections={["Data Management", "App Preferences", "Import / Export", "Offline Database Tools", "Developer / Diagnostics", "Danger Zone"]}
    />
  );
}
