import * as React from "react"

import { cn } from "@/lib/utils"

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

/** Quantities store at millesimal precision (0.005 kg = 5 g). */
function roundQuantity(value: number): number {
  const n = Number(value) || 0
  return Math.round((n + Number.EPSILON) * 1000) / 1000 || 0
}

/** The smallest quantity that survives that rounding. */
export const MIN_QUANTITY = 0.001

/**
 * The number the raw text in a numeric box should commit, or null to leave the
 * value alone — an emptied box, a lone "-" or ".", a "0." on the way to "0.5",
 * anything below `min`, and anything that rounds away below it.
 */
export function parseQuantityDraft(draft: string, min = MIN_QUANTITY): number | null {
  if (draft.trim() === "") return null
  const parsed = Number(draft)
  if (!Number.isFinite(parsed)) return null
  // Round BEFORE the bounds check: 0.0004 clears a min of 0.001 on the raw value
  // but stores as 0, and committing that 0 is the deletion this guards against.
  const rounded = roundQuantity(parsed)
  return rounded >= min ? rounded : null
}

// Makes a numeric box one you can actually clear and retype.
//
// A plain controlled `value={qty} onChange={Number(e.target.value) || 0}` commits
// a 0 on the very keystroke that empties the box, so the old number can never be
// cleared before the new one is typed. In the billing cart that 0 deleted the
// line outright (updateQty drops any line reaching 0); elsewhere it wedged a 0
// the operator had to select over, and it put decimals out of reach wherever the
// box renders 0 as blank — the "0" of "0.5" was erased as it was typed.
//
// Returns props for the caller's own element, so each screen keeps its own
// markup: the billing stepper stays a bare <input>, the dialogs keep <Input>.
//
//   const qty = useQuantityDraft(line.qty, (next) => patchLine(i, { qty: next }));
//   <Input type="number" className="h-9" {...qty} />
//
// It lives in this module rather than its own because a small module imported by
// several route chunks becomes a shared chunk, and below the build's
// experimentalMinChunkSize those get merged into the entry — measured at +67 kB
// of startup JS across the six screens below. This module is already imported by
// ~80 files, so it costs nothing to sit here.
export interface QuantityDraftOptions {
  /**
   * Smallest committable value. MIN_QUANTITY (the default) where a zero would
   * make the row meaningless, such as a cart or order line. Pass 0 where zero is
   * a real answer, such as a return line nobody is returning.
   */
  min?: number
  max?: number
}

export function useQuantityDraft(
  value: number,
  onCommit: (next: number) => void,
  { min = MIN_QUANTITY, max }: QuantityDraftOptions = {},
) {
  // null = not being typed in, so the box tracks `value` and keeps reflecting
  // steppers, scale readings and every other outside edit. A string means mid-edit.
  const [draft, setDraft] = React.useState<string | null>(null)

  const clamp = (next: number) => (max !== undefined ? Math.min(next, max) : next)

  return {
    value: draft ?? String(value),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      setDraft(next)
      const parsed = parseQuantityDraft(next, min)
      if (parsed !== null) onCommit(clamp(parsed))
    },
    onBlur: () => {
      // Leaving the box empty or invalid restores the value the row already has,
      // rather than committing a zero. Removing a row stays a separate action.
      const parsed = draft === null ? null : parseQuantityDraft(draft, min)
      if (parsed !== null && clamp(parsed) !== value) onCommit(clamp(parsed))
      setDraft(null)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === "Escape") { setDraft(null); event.currentTarget.blur() }
    },
  }
}

export { Input }
