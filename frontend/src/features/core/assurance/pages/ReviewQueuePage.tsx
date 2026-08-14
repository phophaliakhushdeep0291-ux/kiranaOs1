import { useAppLanguage } from "@/features/core/settings/i18n";
import FindingsPage from "./FindingsPage";

// The review queue is the findings list scoped to work that still needs a human
// decision. Same surface, different default filter — no duplicated UI.
export default function ReviewQueuePage() {
  const { t } = useAppLanguage();
  return (
    <FindingsPage
      title={t("chrome.reviewQueue")}
      description={t("chrome.reviewQueueHelp")}
      presetOpenOnly
    />
  );
}
