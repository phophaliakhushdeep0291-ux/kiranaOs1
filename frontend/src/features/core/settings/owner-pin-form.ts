import { z } from "zod";
import type { Translate } from "./i18n";

export const ownerPinSchema = (t: Translate) => z.object({
  currentPassword: z.string().min(1, t("settings.security.pwRequired")),
  pin: z.string().regex(/^\d{4}$/, t("settings.security.pinFourDigits")),
  confirmPin: z.string(),
}).refine((data) => data.pin === data.confirmPin, {
  message: t("settings.security.pinMismatch"), path: ["confirmPin"],
});
export type OwnerPinData = z.infer<ReturnType<typeof ownerPinSchema>>;
