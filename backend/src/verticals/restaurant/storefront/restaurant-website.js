/** Public, owner-configured DineIn menu address. No credentials, query redirects or local hosts. */
export function restaurantWebsiteUrl(value) {
  if (typeof value !== "string" || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    if (!/^\/r\/[a-z0-9]+(?:-[a-z0-9]+)*\/?$/.test(url.pathname)) return null;
    if (url.hostname === "localhost" || url.hostname.endsWith(".localhost") || url.hostname.endsWith(".local") || url.hostname.includes(":") || /^\d+\.\d+\.\d+\.\d+$/.test(url.hostname)) return null;
    return url.href.replace(/\/$/, "");
  } catch { return null; }
}
