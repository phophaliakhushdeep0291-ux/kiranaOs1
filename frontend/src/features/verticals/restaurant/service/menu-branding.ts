/**
 * The look and the switches a restaurant's guest menu is served with.
 *
 * Kept in the shop settings blob rather than in its own table because it is a
 * handful of short strings read on every guest scan, and the blob is already
 * pulled to every device and mirrored offline. It has a hard 20 KB ceiling
 * shared with every other setting, which is exactly why a logo is a URL here and
 * never an inlined image: one pasted data-URL would evict the shop's printer
 * configuration.
 */

export interface MenuThemeOption {
  key: string;
  label: string;
  accent: string;
  surface: string;
  ink: string;
}

/**
 * Named presets rather than a free colour field.
 *
 * The person choosing is a restaurant owner at 11pm, not a designer — and a hex
 * code typed into a text box is how a menu ends up at 2:1 contrast, unreadable
 * on a phone in daylight. Each of these is a considered pair, and the same set
 * the server resolves against, so what the owner previews is what a guest gets.
 */
export const MENU_THEME_OPTIONS: MenuThemeOption[] = [
  { key: "classic", label: "Classic", accent: "#b45309", surface: "#fffaf3", ink: "#1c1917" },
  { key: "saffron", label: "Saffron", accent: "#ea580c", surface: "#fff7ed", ink: "#231206" },
  { key: "emerald", label: "Emerald", accent: "#047857", surface: "#f0fdf4", ink: "#052e16" },
  { key: "rose", label: "Rose", accent: "#be123c", surface: "#fff1f2", ink: "#3f0714" },
  { key: "slate", label: "Slate", accent: "#0f766e", surface: "#f8fafc", ink: "#0f172a" },
  { key: "midnight", label: "Midnight bistro", accent: "#818cf8", surface: "#0f172a", ink: "#e2e8f0" },
];

export interface MenuBrand {
  displayName: string;
  tagline: string;
  theme: string;
  logoUrl: string;
  footerNote: string;
}

export interface RestaurantSettings {
  brand?: Partial<MenuBrand>;
  dineIn?: { guestOrders?: boolean };
}

export const BLANK_BRAND: MenuBrand = {
  displayName: "",
  tagline: "",
  theme: "classic",
  logoUrl: "",
  footerNote: "",
};

export function readRestaurantSettings(prefs: Record<string, unknown> | undefined): RestaurantSettings {
  const value = prefs?.restaurant;
  return value && typeof value === "object" && !Array.isArray(value) ? (value as RestaurantSettings) : {};
}

export function readMenuBrand(prefs: Record<string, unknown> | undefined): MenuBrand {
  const brand = readRestaurantSettings(prefs).brand ?? {};
  return {
    displayName: String(brand.displayName ?? ""),
    tagline: String(brand.tagline ?? ""),
    theme: MENU_THEME_OPTIONS.some((option) => option.key === brand.theme) ? String(brand.theme) : "classic",
    logoUrl: String(brand.logoUrl ?? ""),
    footerNote: String(brand.footerNote ?? ""),
  };
}

export function guestOrdersEnabled(prefs: Record<string, unknown> | undefined): boolean {
  return readRestaurantSettings(prefs).dineIn?.guestOrders !== false;
}

/**
 * Trim the brand down to what is worth storing.
 *
 * Empty strings are dropped rather than saved, because a stored "" and an unset
 * field mean the same thing to the server and only one of them costs space in a
 * blob with a ceiling. A logo that is not an http(s) URL is dropped outright:
 * the guest's browser is going to fetch it, and the server refuses anything else
 * anyway — better the owner sees it vanish here than wonders why it never
 * appeared on the menu.
 */
export function toStoredBrand(brand: MenuBrand): Partial<MenuBrand> {
  const stored: Partial<MenuBrand> = {};
  const displayName = brand.displayName.trim();
  const tagline = brand.tagline.trim();
  const footerNote = brand.footerNote.trim();
  const logoUrl = brand.logoUrl.trim();
  if (displayName) stored.displayName = displayName.slice(0, 60);
  if (tagline) stored.tagline = tagline.slice(0, 120);
  if (footerNote) stored.footerNote = footerNote.slice(0, 160);
  if (/^https?:\/\//i.test(logoUrl)) stored.logoUrl = logoUrl.slice(0, 300);
  if (brand.theme && brand.theme !== "classic") stored.theme = brand.theme;
  return stored;
}

export function themeOption(key: string): MenuThemeOption {
  return MENU_THEME_OPTIONS.find((option) => option.key === key) ?? MENU_THEME_OPTIONS[0];
}
