import StaffPage from "@/features/core/staff/pages/StaffPage";
import { FramedSettingsPage } from "@/features/core/settings/SettingsShell";

/** Staff & Permissions tab — frames the existing staff page in the Settings shell. */
export default function StaffSettingsPage() {
  return (
    <FramedSettingsPage>
      <StaffPage embedded />
    </FramedSettingsPage>
  );
}
