import { z } from "zod";
import { round2 } from "./money.js";

const MAX_SAFE_RUPEE_AMOUNT = 100_000_000; // ₹10 crore per field, high enough for SaaS usage but blocks accidental huge payloads.
const MAX_SAFE_QUANTITY = 1_000_000_000;

function hasMaxDecimalPlaces(value, places) {
  if (!Number.isFinite(value)) return false;
  const factor = 10 ** places;
  return Math.abs(value * factor - Math.round(value * factor)) < 1e-8;
}

export function moneyAmount({ min = 0, positive = false, max = MAX_SAFE_RUPEE_AMOUNT } = {}) {
  const base = z.number().finite().max(max, `Amount cannot exceed ₹${max}`);
  const bounded = positive ? base.positive("Amount must be greater than 0") : base.min(min);
  return bounded
    .refine((value) => hasMaxDecimalPlaces(value, 2), "Money amount must have at most 2 decimal places")
    .transform((value) => round2(value));
}

export function percentageRate({ min = 0, max = 100 } = {}) {
  return z.number().finite().min(min).max(max)
    .refine((value) => hasMaxDecimalPlaces(value, 4), "Percentage/rate must have at most 4 decimal places");
}

export function quantityAmount({ min = 0, positive = false, max = MAX_SAFE_QUANTITY } = {}) {
  const base = z.number().finite().max(max, `Quantity cannot exceed ${max}`);
  const bounded = positive ? base.positive("Quantity must be greater than 0") : base.min(min);
  return bounded.refine(
    (value) => hasMaxDecimalPlaces(value, 3),
    "Quantity must have at most 3 decimal places"
  );
}

export function paiseAmount({ positive = false } = {}) {
  const base = z.coerce.number().int().finite();
  return positive ? base.positive("Amount paise must be greater than 0") : base.min(0);
}
