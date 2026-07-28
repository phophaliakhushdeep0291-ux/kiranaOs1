import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

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
  document.documentElement.setAttribute("data-accent", accent);
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

  useEffect(() => {
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
