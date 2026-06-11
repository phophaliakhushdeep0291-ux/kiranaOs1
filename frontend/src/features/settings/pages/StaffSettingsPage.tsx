import StaffPage from "@/features/staff/pages/StaffPage";
import { SettingsShell } from "@/features/settings/SettingsShell";

/** Staff & Permissions tab — frames the existing staff page in the Settings shell. */
export default function StaffSettingsPage() {
  return (
    <SettingsShell>
      <StaffPage />
    </SettingsShell>
  );
}
