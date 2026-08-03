import { createContext, useContext, useLayoutEffect, useState, type ReactNode } from "react";

export type AccentColor = "emerald" | "teal" | "blue" | "violet" | "rose" | "amber" | "orange" | "slate";

export interface AccentDefinition {
  label: string;
  swatch: string;
  description: string;
}

export const ACCENT_COLORS: Record<AccentColor, AccentDefinition> = {
  emerald: { label: "Emerald", swatch: "#16a34a", description: "Fresh green" },
  teal: { label: "Teal", swatch: "#0d9488", description: "Cool blue-green" },
  blue: { label: "Blue", swatch: "#2563eb", description: "Artha premium default" },
  violet: { label: "Violet", swatch: "#7c3aed", description: "Bold and modern purple" },
  rose: { label: "Rose", swatch: "#e11d48", description: "Vibrant and energetic" },
  amber: { label: "Amber", swatch: "#d97706", description: "Warm and inviting gold" },
  orange: { label: "Orange", swatch: "#ea580c", description: "Lively and cheerful" },
  slate: { label: "Slate", swatch: "#475569", description: "Neutral and minimal" },
};

const THEME_KEY = "kirana-os:ui-theme:v1";

interface ThemeContextValue {
  accent: AccentColor;
  setAccent: (c: AccentColor) => void;
}

const ThemeContext = createContext<ThemeContextValue>({ accent: "blue", setAccent: () => {} });

function isAccent(value: unknown): value is AccentColor {
  return typeof value === "string" && value in ACCENT_COLORS;
}

/**
 * Always stamp the attribute, including for blue. Removing it used to leave the
 * :root defaults in charge, which meant the `[data-accent="blue"]` block could
 * never win and switching back to blue relied on the two staying in sync.
 */
export function applyAccent(accent: AccentColor) {
  const root = document.documentElement;
  const hex = ACCENT_COLORS[accent].swatch.replace("#", "");
  const red = Number.parseInt(hex.slice(0, 2), 16) / 255;
  const green = Number.parseInt(hex.slice(2, 4), 16) / 255;
  const blue = Number.parseInt(hex.slice(4, 6), 16) / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  const lightness = (max + min) / 2;
  const delta = max - min;
  const saturation = delta === 0 ? 0 : delta / (1 - Math.abs(2 * lightness - 1));
  let hue = 0;

  if (delta !== 0) {
    if (max === red) hue = ((green - blue) / delta) % 6;
    else if (max === green) hue = (blue - red) / delta + 2;
    else hue = (red - green) / delta + 4;
    hue = Math.round(hue * 60);
    if (hue < 0) hue += 360;
  }

  const h = hue;
  const s = Math.round(saturation * 100);
  const l = Math.round(lightness * 100);
  const hsl = (light: number, sat = s) => `hsl(${h} ${sat}% ${light}%)`;
  const raw = (light: number, sat = s) => `${h} ${sat}% ${light}%`;

  // Inline custom properties make the change immediate and immune to stale or
  // reordered stylesheets. Every branded surface derives from this one palette.
  const tokens: Record<string, string> = {
    "--brand": hsl(l),
    "--brand-strong": hsl(Math.max(24, l - 9)),
    "--brand-soft": hsl(96, Math.max(45, Math.min(s, 78))),
    "--brand-softer": hsl(98, Math.max(35, Math.min(s, 70))),
    "--brand-border": hsl(88, Math.max(35, Math.min(s, 72))),
    "--primary": raw(l),
    "--primary-foreground": accent === "amber" ? "24 10% 10%" : "0 0% 100%",
    "--ring": raw(l),
    "--sidebar": raw(10, Math.min(s, 60)),
    "--sidebar-border": raw(17, Math.min(s, 38)),
    "--sidebar-primary": raw(l),
    "--sidebar-primary-foreground": accent === "amber" ? "24 10% 10%" : "0 0% 100%",
    "--sidebar-accent": raw(19, Math.min(s, 45)),
    "--sidebar-accent-foreground": "0 0% 97%",
    "--sidebar-ring": raw(l),
  };

  root.setAttribute("data-accent", accent);
  Object.entries(tokens).forEach(([property, value]) => root.style.setProperty(property, value));
}

export function AppThemeProvider({ children }: { children: ReactNode }) {
  const [accent, setAccentState] = useState<AccentColor>(() => {
    try {
      const saved = localStorage.getItem(THEME_KEY);
      // "emerald" used to be coerced to blue here because it had no CSS block;
      // it has one now, so every swatch in the picker round-trips.
      return isAccent(saved) ? saved : "blue";
    } catch {
      return "blue";
    }
  });

  useLayoutEffect(() => {
    applyAccent(accent);
  }, [accent]);

  const setAccent = (c: AccentColor) => {
    setAccentState(c);
    try {
      localStorage.setItem(THEME_KEY, c);
    } catch {
      /* the accent still applies for this session */
    }
    applyAccent(c);
  };

  return <ThemeContext.Provider value={{ accent, setAccent }}>{children}</ThemeContext.Provider>;
}

export function useAppTheme() {
  return useContext(ThemeContext);
}
