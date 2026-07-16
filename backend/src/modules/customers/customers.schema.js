import { z } from "zod";
import { moneyAmount } from "../../utils/validationSchemas.js";
import { validateGstin } from "../../utils/gst.js";

const customerFields = {
  name: z.string().min(1),
  mobile: z.string().regex(/^[6-9]\d{9}$/, "Valid Indian mobile required").optional().nullable(),
  address: z.string().trim().max(300).optional().nullable(),
  gstNumber: z.string().trim().toUpperCase().optional().nullable(),
  stateCode: z.string().regex(/^\d{2}$/, "Two-digit GST state code required").optional().nullable(),
  type: z.enum(["regular", "udhar"]).default("regular"),
  udharAmount: moneyAmount().default(0).optional(),
};

function withGstIdentityValidation(schema) {
  return schema.superRefine((customer, ctx) => {
    if (!customer.gstNumber) return;
    const result = validateGstin(customer.gstNumber);
    if (!result.valid) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstNumber"], message: result.reason });
      return;
    }
    if (customer.stateCode && customer.stateCode !== result.stateCode) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["stateCode"], message: "State code must match the GSTIN" });
    }
  }).transform((customer) => {
    if (!customer.gstNumber) return customer;
    const result = validateGstin(customer.gstNumber);
    return result.valid ? { ...customer, gstNumber: result.normalized, stateCode: customer.stateCode || result.stateCode } : customer;
  });
}

export const createCustomerSchema = withGstIdentityValidation(z.object(customerFields));

export const updateCustomerSchema = withGstIdentityValidation(z.object(customerFields).partial().extend({
  reminderOverrideUntil: z.string().datetime().optional(),
}));

export const udharPaymentSchema = z.object({
  locationId: z.string().min(1).optional(),
  amount: moneyAmount({ positive: true }),
  mode: z.enum(["cash", "upi", "bank"]),
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
