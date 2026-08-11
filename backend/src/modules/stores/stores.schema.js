import { z } from "zod";
import { validateGstin } from "../../utils/gst.js";
import { moneyAmount } from "../../utils/validationSchemas.js";

const optionalText = (maximum = 160) => z.string().trim().max(maximum).optional().nullable();
const optionalGstin = z.string().trim().toUpperCase().max(15).optional().nullable()
  .transform((value) => typeof value === "string" && value.length === 0 ? null : value);

const locationFields = {
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().min(2).max(16).regex(/^[A-Za-z0-9_-]+$/).transform((value) => value.toUpperCase()),
  address: optionalText(300),
  city: optionalText(100),
  gstNumber: optionalGstin,
  gstLegalName: optionalText(160),
  gstTradeName: optionalText(160),
  gstRegistrationType: z.enum(["regular", "composition", "casual", "non_resident", "unregistered", "other"]).optional().nullable(),
  phone: z.string().trim().max(15).optional().nullable(),
};

function withLocationGstValidation(schema) {
  return schema.superRefine((location, ctx) => {
    if (!location.gstNumber) return;
    const result = validateGstin(location.gstNumber);
    if (!result.valid) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["gstNumber"], message: result.reason });
  }).transform((location) => {
    if (!Object.prototype.hasOwnProperty.call(location, "gstNumber")) return location;
    if (!location.gstNumber) return { ...location, gstNumber: null, gstStateCode: null };
    const result = validateGstin(location.gstNumber);
    return result.valid
      ? { ...location, gstNumber: result.normalized, gstStateCode: result.stateCode }
      : location;
  });
}

export const createLocationSchema = withLocationGstValidation(z.object(locationFields));

export const updateLocationSchema = withLocationGstValidation(z.object(locationFields).partial().extend({
  active: z.boolean().optional(),
}));

const documentDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Document date must be YYYY-MM-DD").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}, "Document date must be a real calendar date");

export const createTransferSchema = z.object({
  fromLocationId: z.string().min(1),
  toLocationId: z.string().min(1),
  fulfillmentMode: z.enum(["instant", "shipment"]).default("instant"),
  movementReason: z.enum(["branch_transfer", "own_use", "job_work", "repair", "other"]).default("branch_transfer"),
  documentType: z.enum(["delivery_challan", "tax_invoice", "bill_of_supply"]).optional().nullable(),
  documentNumber: z.string().trim().min(1).max(16).regex(/^[A-Za-z0-9/-]+$/, "Use only letters, numbers, slash, or hyphen").optional().nullable(),
  documentDate: documentDate.optional().nullable(),
  note: z.string().trim().max(500).optional().nullable(),
  expectedArrivalDate: documentDate.optional().nullable(),
  carrierName: optionalText(120),
  trackingNumber: z.string().trim().max(80).regex(/^[A-Za-z0-9 ./_-]+$/, "Use a valid tracking reference").optional().nullable(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
  items: z.array(z.object({
    productId: z.string().min(1),
    // Which size is moving, for a product that holds stock per row. Omitted by
    // pooled products, which move as one base-unit pool. A per_pack product that
    // omits it is refused in the service rather than silently drifting.
    sellingUnitId: z.string().min(1).optional().nullable(),
    // How many in that row's own counts (4 pairs). quantityBaseQty stays the
    // base-unit amount, which is what drives tax and value.
    sellingUnitQty: z.coerce.number().positive().finite().optional().nullable(),
    quantityBaseQty: z.coerce.number().positive().finite(),
    declaredTaxableValue: moneyAmount({ positive: true }).optional(),
  })).min(1).max(100),
});

export const receiveTransferSchema = z.object({
  items: z.array(z.object({
    transferItemId: z.string().min(1),
    quantityBaseQty: z.coerce.number().positive().finite(),
  })).min(1).max(100),
  note: z.string().trim().max(500).optional().nullable(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});

export const cancelTransferSchema = z.object({
  reason: z.string().trim().min(8, "Enter a clear cancellation reason").max(500),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
});
export const transferComplianceReviewSchema = z.object({
  decision: z.enum(["external_reference_recorded", "not_required_after_review"]),
  reason: z.string().trim().min(8, "Enter a clear review reason").max(500),
  eWayBillNumber: z.string().trim().regex(/^\d{12}$/, "E-way bill number must contain exactly 12 digits").optional().nullable(),
  eWayBillDate: documentDate.optional().nullable(),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
}).superRefine((value, ctx) => {
  const recordsExternalReference = value.decision === "external_reference_recorded";
  if (recordsExternalReference && !value.eWayBillNumber) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eWayBillNumber"], message: "Enter the 12-digit external e-way bill number" });
  }
  if (recordsExternalReference && !value.eWayBillDate) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eWayBillDate"], message: "Enter the external e-way bill date" });
  }
  if (!recordsExternalReference && (value.eWayBillNumber || value.eWayBillDate)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["eWayBillNumber"], message: "Do not attach e-way bill evidence when the review decision is not required" });
  }
});
