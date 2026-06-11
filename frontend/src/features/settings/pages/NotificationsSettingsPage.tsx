import { Bell } from "lucide-react";
import { SettingsPlaceholder } from "@/features/settings/SettingsShell";

export default function NotificationsSettingsPage() {
  return (
    <SettingsPlaceholder
      title="Notifications"
      icon={<Bell size={26} />}
      blurb="Manage WhatsApp, SMS, email and in-app alerts, reminder templates and the daily summary."
      sections={["Notification Channels", "Alert Rules", "Reminder Templates", "Daily Summary", "Notification History"]}
    />
  );
}
