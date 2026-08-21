import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * A numeric box sitting on a default of "0" is a trap: the caret lands after the
 * zero, so typing a price of 45 leaves "045" and a stock of 5 leaves "05". Every
 * money and quantity field on the new-product form starts at 0, as does the
 * billing discount box, so a shopkeeper had to delete the zero six times per
 * product.
 *
 * Only a lone zero is selected. A real value like 45 is left alone, so editing
 * an existing number still behaves normally.
 */
function selectPlaceholderZero(event: React.FocusEvent<HTMLInputElement>) {
  if (event.target.value === "0") event.target.select()
}

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(
  ({ className, type, onFocus, ...props }, ref) => {
    return (
      <input
        type={type}
        className={cn(
          "flex min-h-11 w-full rounded-lg border border-input bg-background px-3 py-2 text-base shadow-xs transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/35 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
          className
        )}
        ref={ref}
        onFocus={(event) => {
          if (type === "number") selectPlaceholderZero(event)
          onFocus?.(event)
        }}
        {...props}
      />
    )
  }
)
Input.displayName = "Input"

/** Quantities store at millesimal precision (0.005 kg = 5 g); money at paise. */
const QUANTITY_DECIMALS = 3
const MONEY_DECIMALS = 2

function roundTo(value: number, decimals: number): number {
  const factor = 10 ** decimals
  const n = Number(value) || 0
  return Math.round((n + Number.EPSILON) * factor) / factor || 0
}

/** The smallest quantity that survives quantity rounding. */
export const MIN_QUANTITY = 0.001

/**
 * The number the raw text in a numeric box should commit, or null to leave the
 * value alone — an emptied box, a lone "-" or ".", a "0." on the way to "0.5",
 * anything below `min`, and anything that rounds away below it.
 */
export function parseNumericDraft(draft: string, min = 0, decimals = QUANTITY_DECIMALS): number | null {
  if (draft.trim() === "") return null
  const parsed = Number(draft)
  if (!Number.isFinite(parsed)) return null
  // Round BEFORE the bounds check: 0.0004 clears a min of 0.001 on the raw value
  // but stores as 0, and committing that 0 is the deletion this guards against.
  const rounded = roundTo(parsed, decimals)
  return rounded >= min ? rounded : null
}

/** Quantity flavour: millesimal precision, and MIN_QUANTITY as the default floor. */
export function parseQuantityDraft(draft: string, min = MIN_QUANTITY): number | null {
  return parseNumericDraft(draft, min, QUANTITY_DECIMALS)
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
export interface NumericDraftOptions {
  /**
   * Smallest committable value. MIN_QUANTITY where a zero would make the row
   * meaningless, such as a cart or order line. 0 where zero is a real answer —
   * a return line nobody is returning, a rate that really is free.
   */
  min?: number
  max?: number
  decimals?: number
  /**
   * Commit null when the box is emptied, instead of leaving the value alone.
   * For a field where "nothing typed" must be distinguishable from a typed 0 —
   * bulk edit, where a blank box previously armed "set to 0" across the whole
   * selection. Callers using this take `number | null` in onCommit.
   */
  emptyCommitsNull?: boolean
}

export function useNumericDraft(
  value: number | null,
  onCommit: (next: number | null) => void,
  { min = 0, max, decimals = QUANTITY_DECIMALS, emptyCommitsNull = false }: NumericDraftOptions = {},
) {
  // null = not being typed in, so the box tracks `value` and keeps reflecting
  // steppers, scale readings and every other outside edit. A string means mid-edit.
  const [draft, setDraft] = React.useState<string | null>(null)

  const clamp = (next: number) => (max !== undefined ? Math.min(next, max) : next)
  const commit = onCommit

  return {
    value: draft ?? (value === null ? "" : String(value)),
    onChange: (event: React.ChangeEvent<HTMLInputElement>) => {
      const next = event.target.value
      setDraft(next)
      const parsed = parseNumericDraft(next, min, decimals)
      if (parsed !== null) commit(clamp(parsed))
      else if (emptyCommitsNull && next.trim() === "" && value !== null) commit(null)
    },
    onBlur: () => {
      // Leaving the box empty or invalid restores the value the row already has,
      // rather than committing a zero. Removing a row stays a separate action.
      const parsed = draft === null ? null : parseNumericDraft(draft, min, decimals)
      if (parsed !== null && clamp(parsed) !== value) commit(clamp(parsed))
      setDraft(null)
    },
    onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur() }
      if (event.key === "Escape") { setDraft(null); event.currentTarget.blur() }
    },
  }
}

/** Quantity box: millesimal precision, MIN_QUANTITY floor unless told otherwise. */
export function useQuantityDraft(
  value: number,
  onCommit: (next: number) => void,
  { min = MIN_QUANTITY, max }: { min?: number; max?: number } = {},
) {
  return useNumericDraft(
    value,
    (next) => { if (next !== null) onCommit(next) },
    { min, max, decimals: QUANTITY_DECIMALS },
  )
}

/**
 * Money box: paise precision, and 0 is allowed by default — a rate or discount
 * of zero is a real answer, unlike a cart line of zero.
 */
export function useMoneyDraft(
  value: number,
  onCommit: (next: number) => void,
  { min = 0, max }: { min?: number; max?: number } = {},
) {
  return useNumericDraft(
    value,
    (next) => { if (next !== null) onCommit(next) },
    { min, max, decimals: MONEY_DECIMALS },
  )
}

export { Input }
