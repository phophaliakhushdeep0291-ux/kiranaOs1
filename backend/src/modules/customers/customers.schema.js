import { z } from "zod";
import { moneyAmount } from "../../utils/validationSchemas.js";

export const createCustomerSchema = z.object({
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid Indian mobile required").optional().nullable(),
  type: z.enum(["regular", "udhar"]).default("regular"),
  udharAmount: moneyAmount().default(0).optional(),
});

export const updateCustomerSchema = createCustomerSchema.partial().extend({
  reminderOverrideUntil: z.string().datetime().optional(),
});

export const udharPaymentSchema = z.object({
  amount: moneyAmount({ positive: true }),
  mode: z.enum(["cash", "upi"]),
  note: z.string().optional(),
  localLedgerEntryId: z.string().min(1).optional(),
  local_ledger_entry_id: z.string().min(1).optional(),
  clientLedgerId: z.string().min(1).optional(),
  client_ledger_id: z.string().min(1).optional(),
  ledgerEntryId: z.string().min(1).optional(),
  ledger_entry_id: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).optional(),
  idempotency_key: z.string().min(1).optional(),
  sourceDeviceId: z.string().min(1).optional(),
  source_device_id: z.string().min(1).optional(),
});


export const reverseUdharPaymentSchema = z.object({
  reason: z.string().min(3, "Reversal reason required").max(500),
  ownerPin: z.string().optional(),
});
