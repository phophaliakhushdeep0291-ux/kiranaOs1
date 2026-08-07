import type { StorefrontBranding } from "./catalog";

/**
 * How one restaurant's menu is told apart from the next one's.
 *
 * The server sends a small, already-validated presentation: a display name, a
 * tagline, and a considered pair of colours. This turns that into CSS custom
 * properties, so the whole page is themed by one style object rather than by
 * conditionals scattered through the markup — which is what makes "different for
 * every restaurant" a data change instead of a code change.
 *
 * The derived values matter as much as the given ones. A menu needs a muted ink
 * for descriptions, a hairline for dividers and a tint for chips, and deriving
 * them from the restaurant's own two colours is what stops a themed page looking
 * like someone else's design with one button recoloured.
 */

export interface DineInTheme {
  style: Record<string, string>;
  /** True when the restaurant chose a dark surface, so photos and chips adapt. */
  dark: boolean;
}

function hexToRgb(hex: string): [number, number, number] | null {
  const match = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!match) return null;
  const value = parseInt(match[1], 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

/**
 * Perceived brightness, not the arithmetic mean.
 *
 * Green reads far brighter to the eye than blue at the same numeric value, so
 * averaging the channels would call a deep green surface "light" and put dark
 * grey text on it. These are the sRGB luminance weights.
 */
export function isDarkSurface(hex: string): boolean {
  const rgb = hexToRgb(hex);
  if (!rgb) return false;
  const [r, g, b] = rgb;
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 < 0.5;
}

function rgba(hex: string, alpha: number, fallback: string): string {
  const rgb = hexToRgb(hex);
  if (!rgb) return fallback;
  return `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${alpha})`;
}

export const FALLBACK_BRANDING: StorefrontBranding = {
  displayName: "Menu",
  tagline: null,
  themeKey: "classic",
  accent: "#b45309",
  surface: "#fffaf3",
  ink: "#1c1917",
  logoUrl: null,
  footerNote: null,
};

export function dineInTheme(branding: StorefrontBranding | null | undefined): DineInTheme {
  const brand = branding ?? FALLBACK_BRANDING;
  const dark = isDarkSurface(brand.surface);
  return {
    dark,
    style: {
      "--menu-accent": brand.accent,
      "--menu-surface": brand.surface,
      "--menu-ink": brand.ink,
      // A card has to lift off the surface in both directions: white on a cream
      // page, and a lighter slate on a midnight one.
      "--menu-card": dark ? rgba("#ffffff", 0.06, "#1e293b") : "#ffffff",
      "--menu-muted": rgba(brand.ink, dark ? 0.68 : 0.62, dark ? "#cbd5e1" : "#52627e"),
      "--menu-line": rgba(brand.ink, dark ? 0.16 : 0.1, dark ? "#334155" : "#e8eef7"),
      "--menu-tint": rgba(brand.accent, dark ? 0.2 : 0.1, "#f5f5f4"),
      "--menu-shadow": dark ? "0 1px 2px rgba(0,0,0,.5)" : "0 1px 2px rgba(15,23,42,.06)",
    },
  };
}
