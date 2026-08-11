import { formatInrFromPaise } from "./money.mjs";

const DISPLAY_STATES = new Set(["idle", "sale", "awaiting_payment", "paid", "cancelled"]);
const DEFAULT_WIDTH = 20;
const MIN_WIDTH = 12;
const MAX_WIDTH = 80;
const MAX_TOTAL_PAISE = 999_999_999_999;

function hardwareInputError(message) {
  return Object.assign(new Error(message), { status: 400 });
}

function fitLine(value, width) {
  const line = String(value ?? "").trim();
  if (/[^\x20-\x7e]/.test(line)) throw hardwareInputError("Customer display text must contain printable ASCII only");
  if (line.length > width) throw hardwareInputError(`Customer display text exceeds the configured ${width}-character width`);
  return line;
}

export function normalizeDisplayWidth(value) {
  const width = Math.floor(Number(value) || DEFAULT_WIDTH);
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, width));
}

/**
 * "SCAN TO PAY" is deliberately the shortest prompt that still reads as an
 * instruction: a customer display can be as narrow as 12 characters, and a
 * prompt that does not fit is thrown out rather than silently truncated.
 */
function displayLines(state, itemCount, amount) {
  switch (state) {
    case "idle": return ["WELCOME", "READY"];
    case "awaiting_payment": return ["SCAN TO PAY", amount];
    case "paid": return ["PAYMENT RECEIVED", amount];
    case "cancelled": return ["SALE CANCELLED", "READY"];
    default: return [`${itemCount} ${itemCount === 1 ? "ITEM" : "ITEMS"}`, `TOTAL ${amount}`];
  }
}

/**
 * Convert the browser's structured cart state into the two trusted lines sent
 * to a vendor adapter. The browser cannot inject terminal control sequences or
 * invent free-form display text; money stays integer paise end to end.
 */
export function buildCustomerDisplayFrame(input, { width = DEFAULT_WIDTH } = {}) {
  const displayWidth = normalizeDisplayWidth(width);
  const revision = Number(input?.revision);
  const state = String(input?.state || "").trim().toLowerCase();
  const itemCount = Number(input?.itemCount);
  const totalPaise = Number(input?.totalPaise);

  if (!Number.isSafeInteger(revision) || revision < 0) throw hardwareInputError("Customer display revision must be a non-negative safe integer");
  if (!DISPLAY_STATES.has(state)) throw hardwareInputError("Customer display state is invalid");
  if (!Number.isInteger(itemCount) || itemCount < 0 || itemCount > 9_999) throw hardwareInputError("Customer display item count is invalid");
  if (!Number.isSafeInteger(totalPaise) || totalPaise < 0 || totalPaise > MAX_TOTAL_PAISE) throw hardwareInputError("Customer display total is invalid");

  const lines = displayLines(state, itemCount, formatInrFromPaise(totalPaise));

  return {
    revision,
    state,
    itemCount,
    totalPaise,
    width: displayWidth,
    lines: lines.map((line) => fitLine(line, displayWidth)),
  };
}
