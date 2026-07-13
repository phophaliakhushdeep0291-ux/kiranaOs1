import { z } from "zod";

export const complianceExportQuery = z.object({
  range: z.enum(["daily", "weekly", "monthly", "yearly", "custom"]).optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  format: z.enum(["json", "csv"]).default("json"),
});

export const hsnCategoryAssignmentSchema = z.object({
  category: z.string().trim().max(120).nullable(),
  hsn: z.string().trim().regex(/^\d{4}(?:\d{2})?(?:\d{2})?$/, "HSN must contain 4, 6 or 8 digits"),
  gstRate: z.coerce.number().min(0).max(100),
  ownerPin: z.string().regex(/^\d{4}$/).optional(),
}).strict();

const optionalTrimmed = z.string().trim().max(120).optional().or(z.literal(""));

export const eWayBillSchema = z.object({
  transportMode: z.enum(["road", "rail", "air", "ship"]),
  transporterId: optionalTrimmed,
  transporterName: optionalTrimmed,
  vehicleNumber: optionalTrimmed,
  vehicleType: z.enum(["regular", "over_dimensional"]).default("regular"),
  distanceKm: z.coerce.number().int().min(1).max(4000),
  transportDocumentNumber: optionalTrimmed,
  transportDocumentDate: z.string().trim().max(10).optional().or(z.literal("")),
  deliveryAddress: z.string().trim().min(5).max(500),
}).superRefine((value, context) => {
  if (value.transportMode === "road" && !value.vehicleNumber) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicleNumber"], message: "Vehicle number is required for road transport" });
  }
  if (value.vehicleNumber && !/^[A-Z0-9 -]{6,20}$/i.test(value.vehicleNumber)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["vehicleNumber"], message: "Enter a valid vehicle number" });
  }
  if (!value.transporterId && !value.transporterName) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ["transporterName"], message: "Enter a transporter ID or transporter name" });
  }
});
