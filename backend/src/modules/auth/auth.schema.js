import { z } from "zod";

const trimmedString = (min, message) => z.preprocess((value) => {
  if (typeof value !== "string") return value;
  return value.trim();
}, z.string().min(min, message));

const optionalTrimmedString = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}, z.string().optional());

const optionalEmail = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") return value;
  const trimmed = value.trim().toLowerCase();
  return trimmed === "" ? undefined : trimmed;
}, z.string().email("Valid email address required").optional());

export const normalizeIndianMobile = (value) => {
  if (typeof value !== "string") return value;
  let text = value.trim();
  text = text.replace(/[\s\-()]/g, "");
  if (text.startsWith("+91")) text = text.slice(3);
  if (text.startsWith("91") && text.length === 12) text = text.slice(2);
  return text;
};

const indianMobile = z.preprocess(
  normalizeIndianMobile,
  z.string().regex(/^[6-9]\d{9}$/, "Valid Indian mobile number required")
);

const optionalIndianMobile = z.preprocess((value) => {
  if (value === undefined || value === null) return undefined;
  const normalized = normalizeIndianMobile(value);
  return normalized === "" ? undefined : normalized;
}, z.string().regex(/^[6-9]\d{9}$/, "Valid Indian mobile number required").optional());

const deviceMetadataSchema = z.object({
  deviceId: z.string().min(3).max(128),
  deviceName: z.string().trim().min(1).max(120).optional(),
  deviceType: z.enum(["desktop", "laptop", "mobile", "tablet"]).optional(),
  operatingSystem: z.string().trim().max(60).optional(),
  browser: z.string().trim().max(60).optional(),
  platform: z.string().trim().max(50).optional(),
  appVersion: z.string().trim().max(40).optional(),
}).strict();

export const registerSchema = z.object({
  shopName:  trimmedString(2),
  ownerName: trimmedString(2),
  city:      trimmedString(2),
  address:   trimmedString(5),
  mobile:    indianMobile,
  email:     optionalEmail,
  password:  z.string().min(6),
  ownerPin:  z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits").optional(),
  gstNumber: optionalTrimmedString,
  phone:     optionalTrimmedString,
  device:    deviceMetadataSchema.optional(),
});

export const loginSchema = z.object({
  mobile:     optionalIndianMobile,
  email:      optionalEmail,
  identifier: optionalTrimmedString,
  password:   z.string(),
  shopId:     z.string().optional(),
  device:     deviceMetadataSchema.optional(),
}).refine((value) => value.mobile || value.email || value.identifier, {
  message: "Mobile number or email is required",
  path: ["identifier"],
});

export const googleLoginSchema = z.object({
  credential: z.string().min(20).max(16_384), // GIS ID token (JWT), bounded before decode/verification.
  shopId: z.string().min(1).optional(),
  device: deviceMetadataSchema.optional(),
});

export const deviceReplacementSchema = z.object({
  replacementToken: z.string().min(20).max(4096),
  targetDeviceId: z.string().min(1).max(128),
  ownerPin: z.string().regex(/^\d{4}$/, "Owner PIN must be exactly 4 digits"),
  device: deviceMetadataSchema.optional(),
}).strict();

export const verifyEmailSchema = z.object({
  token: z.string().min(20),
});

export const resendVerificationSchema = z.object({
  mobile:     optionalIndianMobile,
  email:      optionalEmail,
  identifier: optionalTrimmedString,
  shopId:     z.string().optional(),
}).refine((value) => value.mobile || value.email || value.identifier, {
  message: "Mobile number or email is required",
  path: ["identifier"],
});

export const forgotPasswordSchema = resendVerificationSchema;

export const resetPasswordSchema = z.object({
  token: z.string().min(20),
  newPassword: z.string().min(6),
});

export const setPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be exactly 4 digits"),
});

export const verifyPinSchema = z.object({
  pin: z.string().regex(/^\d{4}$/, "PIN must be 4 digits"),
});

export const inviteStaffSchema = z.object({
  name:     z.string().min(2),
  mobile:   indianMobile,
  password: z.string().min(6),
  // Owners cannot be invited through staff management; owner transfer needs a separate audited flow.
  role:     z.enum(["staff", "admin"]).default("staff"),
});

const staffLocationAssignmentSchema = z.object({
  locationId: z.string().min(1),
  canSell: z.boolean().default(true),
  canPurchase: z.boolean().default(false),
  canManageInventory: z.boolean().default(false),
  canTransfer: z.boolean().default(false),
}).strict();

export const staffLocationAssignmentsSchema = z.object({
  locations: z.array(staffLocationAssignmentSchema).min(1, "Assign at least one store location").max(100),
  ownerPin: z.string().regex(/^\d{4}$/, "Owner PIN must be exactly 4 digits").optional(),
}).strict().superRefine((value, ctx) => {
  const seen = new Set();
  value.locations.forEach((location, index) => {
    if (seen.has(location.locationId)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Each store location can only be assigned once",
        path: ["locations", index, "locationId"],
      });
    }
    seen.add(location.locationId);
  });
});

export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword:     z.string().min(6),
});

export const refreshSchema = z.object({
  refreshToken: z.string().min(20),
});

export const logoutSchema = z.object({
  refreshToken: z.string().min(20),
});
