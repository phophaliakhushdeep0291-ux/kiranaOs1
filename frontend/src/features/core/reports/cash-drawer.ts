import { offlineDB } from "@/lib/offline/db";
import { roundMoney } from "@/lib/money";

/**
 * The till, as opposed to the takings.
 *
 * Expected cash used to be "cash collected − supplier cash paid", which is only the
 * money that moved through SALES. A real drawer also starts the morning with a float
 * the owner puts in, and loses cash to anything paid out of it during the day. Without
 * those, the over/short at closing is wrong every single day — and a control that is
 * always wrong stops being read.
 *
 * Opening float is DECLARED each morning rather than carried forward from last night's
 * count: carrying forward would silently roll yesterday's shortage into today's expected
 * figure and hide it. This is what standard POS does.
 *
 * Stored in the offline settings blob, per device/shop scope — the same place and
 * lifetime as the drawer counts these figures are compared against.
 */

export type CashMovementKind = "in" | "out";

export interface CashMovement {
  id: string;
  /** Business date, yyyy-mm-dd. */
  date: string;
  kind: CashMovementKind;
  amount: number;
  note: string;
  at: string;
}

export interface OpeningFloat {
  /** Business date, yyyy-mm-dd. One declaration per date (latest wins). */
  date: string;
  amount: number;
  at: string;
}

const FLOAT_KEY = "kirana:opening-float:v1";
const MOVEMENT_KEY = "kirana:cash-movements:v1";
const MAX_DAYS = 90;

function sanitizeAmount(value: unknown): number {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? roundMoney(amount) : 0;
}

/** Pure upsert: one float per date, newest first, capped. */
export function upsertOpeningFloat(list: OpeningFloat[], entry: OpeningFloat, cap = MAX_DAYS): OpeningFloat[] {
  return [entry, ...list.filter((row) => row.date !== entry.date)]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, cap);
}

export function buildOpeningFloat(date: string, amount: number): OpeningFloat {
  return { date, amount: sanitizeAmount(amount), at: new Date().toISOString() };
}

export function buildCashMovement(date: string, kind: CashMovementKind, amount: number, note: string): CashMovement {
  return {
    id: `cash_${kind}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    date,
    kind,
    amount: sanitizeAmount(amount),
    note: String(note ?? "").trim().slice(0, 120),
    at: new Date().toISOString(),
  };
}

/** Cash added to and taken out of the till on one date. */
export function summarizeCashMovements(list: CashMovement[], date: string): { cashIn: number; cashOut: number } {
  const forDate = list.filter((row) => row.date === date);
  return {
    cashIn: roundMoney(forDate.filter((row) => row.kind === "in").reduce((sum, row) => sum + row.amount, 0)),
    cashOut: roundMoney(forDate.filter((row) => row.kind === "out").reduce((sum, row) => sum + row.amount, 0)),
  };
}

export function openingFloatFor(list: OpeningFloat[], date: string): number {
  return list.find((row) => row.date === date)?.amount ?? 0;
}

export async function loadOpeningFloats(): Promise<OpeningFloat[]> {
  const stored = await offlineDB.getSetting<OpeningFloat[]>(FLOAT_KEY).catch(() => null);
  return Array.isArray(stored) ? stored : [];
}

export async function saveOpeningFloat(entry: OpeningFloat): Promise<OpeningFloat[]> {
  const next = upsertOpeningFloat(await loadOpeningFloats(), entry);
  await offlineDB.setSetting(FLOAT_KEY, next);
  return next;
}

export async function loadCashMovements(): Promise<CashMovement[]> {
  const stored = await offlineDB.getSetting<CashMovement[]>(MOVEMENT_KEY).catch(() => null);
  return Array.isArray(stored) ? stored : [];
}

export async function saveCashMovement(entry: CashMovement): Promise<CashMovement[]> {
  const existing = await loadCashMovements();
  // Keep only recent dates so the blob cannot grow without bound.
  const cutoff = new Date(Date.now() - MAX_DAYS * 86_400_000).toISOString().slice(0, 10);
  const next = [entry, ...existing.filter((row) => row.date >= cutoff)]
    .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? ""));
  await offlineDB.setSetting(MOVEMENT_KEY, next);
  return next;
}

export async function removeCashMovement(id: string): Promise<CashMovement[]> {
  const next = (await loadCashMovements()).filter((row) => row.id !== id);
  await offlineDB.setSetting(MOVEMENT_KEY, next);
  return next;
}

/** Everything the drawer calculation needs for one date. */
export async function loadDrawerAdjustments(date: string): Promise<{ openingCash: number; cashIn: number; cashOut: number }> {
  const [floats, movements] = await Promise.all([loadOpeningFloats(), loadCashMovements()]);
  return { openingCash: openingFloatFor(floats, date), ...summarizeCashMovements(movements, date) };
}
