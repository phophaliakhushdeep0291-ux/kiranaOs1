import SyncStatusPage from "@/features/sync/pages/SyncStatusPage";
import { SettingsShell } from "@/features/settings/SettingsShell";

/** Sync & Backup tab — frames the existing sync status page in the Settings shell. */
export default function SyncSettingsPage() {
  return (
    <SettingsShell>
      <SyncStatusPage />
    </SettingsShell>
  );
}
