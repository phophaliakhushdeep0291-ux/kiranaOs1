/**
 * Reference-matched chip palette: vivid mid-tone text on a soft ~8% tint of the
 * same hue — the look of the design mockups (Cash green, UPI violet, Card blue,
 * Partial orange, Unpaid red, Synced green…). Single source of truth so every
 * page's badges stay identical; pages compose their own geometry around these.
 */
export type ChipTone = "green" | "violet" | "blue" | "amber" | "orange" | "red" | "gray";

export const CHIP_TONES: Record<ChipTone, string> = {
  green: "bg-[#e6f7ee] text-[var(--success-ink)]",
  violet: "bg-[#f1ecfe] text-[#7c3aed]",
  blue: "bg-[#e8f0fe] text-[var(--brand)]",
  amber: "bg-[#fdf3e1] text-[#d97706]",
  orange: "bg-[#fff0e6] text-[#ea580c]",
  red: "bg-[#fdebeb] text-[#ef4444]",
  gray: "bg-[#eef2f7] text-[#64748b]",
};
