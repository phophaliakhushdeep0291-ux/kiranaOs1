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
});

export const loginSchema = z.object({
  mobile:     optionalIndianMobile,
  email:      optionalEmail,
  identifier: optionalTrimmedString,
  password:   z.string(),
  shopId:     z.string().optional(),
}).refine((value) => value.mobile || value.email || value.identifier, {
  message: "Mobile number or email is required",
  path: ["identifier"],
});

export const googleLoginSchema = z.object({
  credential: z.string().min(20).max(16_384), // GIS ID token (JWT), bounded before decode/verification.
  shopId: z.string().min(1).optional(),
});

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
