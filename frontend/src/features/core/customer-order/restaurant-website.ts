/** Only an explicit tenant menu URL may redirect guests; never a query-string target. */
export function restaurantWebsiteUrl(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/r\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname)) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}

export function restaurantGuestUrl(value: unknown, tableCode?: string | null): string | null {
  const base = restaurantWebsiteUrl(value);
  return base ? `${base}${tableCode ? `/t/${encodeURIComponent(tableCode)}` : ""}` : null;
}

export function websiteFromPrefs(prefs: Record<string, unknown>): string | null {
  const restaurant = prefs.restaurant as { brand?: { websiteUrl?: unknown } } | undefined;
  return restaurantWebsiteUrl(restaurant?.brand?.websiteUrl);
}

export function guestWebsiteRedirect(catalog: { storefront?: { mode: string; branding?: { websiteUrl?: string | null } | null } }, currentUrl: string, tableCode?: string | null): string | null {
  if (catalog.storefront?.mode !== "dine_in") return null;
  const target = restaurantGuestUrl(catalog.storefront.branding?.websiteUrl, tableCode);
  // An old POS host must never redirect to itself (avoids routing/rewrite loops).
  return target && new URL(target).origin !== new URL(currentUrl).origin ? target : null;
}
