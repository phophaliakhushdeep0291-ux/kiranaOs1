/**
 * The back-and-forth that turns dictation into a saveable customer.
 *
 * Same shape as the product one, and the same restraint: only the fields the
 * save actually refuses to go without are compulsory, plus the one or two a shop
 * always knows while the person is still standing there. `saveCustomer()` rejects
 * a missing name and a missing or malformed mobile, so those two are the
 * required pair; the credit limit is asked for only when the sentence has
 * already said this is a khata customer, because a limit means nothing for
 * someone who pays cash.
 */
import type { TranslationKey } from "@/features/core/settings/i18n";
import { isValidIndianCustomerMobile } from "./customer-reliability";
import type { CustomerVoiceField, CustomerVoiceFields } from "./customer-voice-parser";

/**
 * The customer form's own state, as CustomersPage holds it.
 *
 * Declared structurally rather than imported from the page, so this module stays
 * free of the page's React tree while the page's own interface still satisfies it.
 */
export type CustomerVoiceFormValues = {
  name: string;
  mobile: string;
  address: string;
  gstNumber: string;
  stateCode: string;
  type: "regular" | "udhar";
  dueDate: string;
  promiseToPayDate: string;
  udharLimit: string;
  notes: string;
};

/** The two `saveCustomer()` refuses to go without. */
const REQUIRED_FIELDS: CustomerVoiceField[] = ["name", "mobile"];

/** What gets asked, in order. */
const PROMPT_ORDER: CustomerVoiceField[] = ["name", "mobile", "address", "udharLimit"];

export const CUSTOMER_VOICE_PROMPT_KEYS: Record<CustomerVoiceField, TranslationKey> = {
  name: "customers.voice.ask.name",
  mobile: "customers.voice.ask.mobile",
  address: "customers.voice.ask.address",
  udharLimit: "customers.voice.ask.udharLimit",
  gstNumber: "customers.voice.ask.gstNumber",
  dueDate: "customers.voice.ask.dueDate",
  promiseToPayDate: "customers.voice.ask.promiseToPayDate",
  notes: "customers.voice.ask.notes",
  type: "customers.voice.ask.type",
};

export function isCustomerVoiceFieldAnswered(
  values: CustomerVoiceFormValues,
  field: CustomerVoiceField,
): boolean {
  if (field === "name") return values.name.trim().length > 0;
  // Ten digits that the form would reject is not an answer — it is a mishearing
  // that would only surface as a red toast at the Save button.
  if (field === "mobile") return isValidIndianCustomerMobile(values.mobile);
  if (field === "address") return values.address.trim().length > 0;
  if (field === "udharLimit") return Number(values.udharLimit) > 0;
  return false;
}

/**
 * The next thing to ask for, or null when there is nothing left worth asking.
 *
 * The credit limit is skipped entirely unless the customer is already known to
 * be on khata — asking a cash customer for their limit invites an answer that
 * quietly turns them into a credit account.
 */
export function nextCustomerVoiceField(
  values: CustomerVoiceFormValues,
  handled: ReadonlySet<CustomerVoiceField>,
): CustomerVoiceField | null {
  for (const field of PROMPT_ORDER) {
    if (field === "udharLimit" && values.type !== "udhar") continue;
    if (handled.has(field)) continue;
    if (isCustomerVoiceFieldAnswered(values, field)) continue;
    return field;
  }
  // A required field that was skipped still has to be asked again, or the
  // conversation ends by moving the failure to the Save button.
  for (const field of REQUIRED_FIELDS) {
    if (!isCustomerVoiceFieldAnswered(values, field)) return field;
  }
  return null;
}

export function isCustomerReadyToSave(values: CustomerVoiceFormValues): boolean {
  return REQUIRED_FIELDS.every((field) => isCustomerVoiceFieldAnswered(values, field));
}

/**
 * Fold everything voice understood into the form.
 *
 * Stated fields overwrite; everything else is left exactly as the shop typed it,
 * so dictating one correction cannot silently blank the rest of the form.
 */
export function applyCustomerVoiceFields(
  values: CustomerVoiceFormValues,
  fields: CustomerVoiceFields,
): CustomerVoiceFormValues {
  return {
    ...values,
    name: fields.name ?? values.name,
    mobile: fields.mobile ?? values.mobile,
    address: fields.address ?? values.address,
    gstNumber: fields.gstNumber ?? values.gstNumber,
    stateCode: fields.stateCode ?? values.stateCode,
    type: fields.type ?? values.type,
    dueDate: fields.dueDate ?? values.dueDate,
    promiseToPayDate: fields.promiseToPayDate ?? values.promiseToPayDate,
    udharLimit: fields.udharLimit === undefined ? values.udharLimit : String(fields.udharLimit),
    notes: fields.notes ?? values.notes,
  };
}
