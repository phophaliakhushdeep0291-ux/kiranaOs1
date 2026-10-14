// Accounting entry points are visible in the offline shell and Reports page.
import type { accountingNavigationEn } from "./accounting-navigation";
export const accountingNavigationHi: Record<keyof typeof accountingNavigationEn, string> = {
  "accounting.title": "लेखा-जोखा",
  "accounting.entry.body": "ट्रायल बैलेंस, लाभ-हानि, बैलेंस शीट और खातों की सूची।",
  "accounting.entry.action": "खोलें",
  "accounting.entry.menuHelper": "ट्रायल बैलेंस, लाभ-हानि, बैलेंस शीट",
} as const;
