/**
 * Default landing page (Advanced settings) — where the app opens after login.
 * Backed by localStorage so the route guards can read it synchronously at app
 * load, mirroring how tax/printer config expose a sync getter. The label set
 * matches the Advanced settings Select; unknown values fall back to Dashboard.
 */
const KEY = "kiranaos.landingPage.v1";

const LABEL_TO_ROUTE: Record<string, string> = {
  Dashboard: "/dashboard",
  Billing: "/billing",
  Inventory: "/inventory",
  Reports: "/reports",
};

export function setLandingPagePref(label: string): void {
  try {
    if (LABEL_TO_ROUTE[label]) localStorage.setItem(KEY, label);
  } catch { /* storage unavailable — ignore */ }
}

export function getLandingRoute(): string {
  try {
    return LABEL_TO_ROUTE[localStorage.getItem(KEY) ?? ""] ?? "/dashboard";
  } catch {
    return "/dashboard";
  }
}
