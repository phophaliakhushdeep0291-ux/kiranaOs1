import { Receipt } from "lucide-react";
import { SettingsPlaceholder } from "@/features/settings/SettingsShell";

export default function TaxesSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Taxes & GST"
      icon={<Receipt size={26} />}
      blurb="Configure GST mode, rates, HSN mapping and compliance so every bill is accurate."
      sections={["GST Configuration", "GST Rates", "HSN / Product Mapping", "GST Reports", "Compliance Settings"]}
    />
  );
}
