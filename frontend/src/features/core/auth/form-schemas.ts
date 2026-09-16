import { z } from "zod";

export const recoverySchema = z.object({
  identifier: z.string().trim().min(3, "auth.identifierRequired"),
});

export const loginSchema = recoverySchema.extend({
  // Spaces can be intentional in a password; never normalize credentials.
  password: z.string().min(1, "auth.passwordRequired"),
});

export const resetPasswordSchema = z.object({
  newPassword: z.string().min(6, "auth.passwordMin"),
  confirmPassword: z.string().min(1, "auth.confirmPasswordRequired"),
}).refine((value) => value.newPassword === value.confirmPassword, {
  message: "auth.passwordMismatch",
  path: ["confirmPassword"],
});

// React Hook Form exposes messages as plain strings. Narrow them to this
// schema's key set before passing them to the typed translator.
export function authValidationKey(message?: string) {
  switch (message) {
    case "auth.identifierRequired":
    case "auth.passwordRequired":
    case "auth.passwordMin":
    case "auth.confirmPasswordRequired":
    case "auth.passwordMismatch":
      return message;
    default:
      return "auth.loginFailed";
  }
}
