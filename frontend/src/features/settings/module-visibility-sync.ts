import { useEffect } from "react";
import { useGetShop } from "@/lib/api/client";
import { saveModuleVisibility, sanitizeModuleVisibility } from "@/features/settings/modules";

/**
 * Pulls the owner's module on/off choices down from the shop profile
 * (Shop.settingsJson → moduleVisibility) so a phone shows the same trimmed-down
 * app as the counter PC.
 *
 * Pull only. Writes are owned by the Modules settings page, which patches the
 * settings blob through useSettingsPrefs — that keeps a single writer for the
 * blob and removes any chance of two paths clobbering each other. Re-running on
 * every settingsJson change (rather than once per shop) is what makes a change
 * saved on another device land here on the next refetch.
 */
export function useModuleVisibilityServerSync() {
  const shop = useGetShop();
  const raw = shop.data?.settingsJson;

  useEffect(() => {
    if (raw == null) return;
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(raw || "{}") as Record<string, unknown>;
    } catch {
      return; // malformed blob — leave it to the settings module
    }
    if (!parsed || typeof parsed !== "object") return;
    if (parsed.moduleVisibility == null) return; // never chosen — keep local
    saveModuleVisibility(sanitizeModuleVisibility(parsed.moduleVisibility));
  }, [raw]);
}
