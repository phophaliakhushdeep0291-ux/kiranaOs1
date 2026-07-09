import DevicesPage from "@/features/devices/pages/DevicesPage";
import { FramedSettingsPage } from "@/features/settings/SettingsShell";

/** Device Management tab — frames the existing devices page in the Settings shell. */
export default function DevicesSettingsPage() {
  return (
    <FramedSettingsPage>
      <DevicesPage embedded />
    </FramedSettingsPage>
  );
}
