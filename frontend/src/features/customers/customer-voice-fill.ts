import type { CustomerDraft } from "@/features/voice/voice-types";
import type { CustomerWithLedger } from "./customer-ledger-data";
import {
  findDuplicateCustomerWarnings,
  normaliseCustomerMobile,
  type DuplicateCustomerWarning,
} from "./customer-reliability";

export type CustomerVoicePreviewField = {
  label: string;
  value: string;
};

function formatFieldValue(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return String(value);
}

export function buildCustomerVoicePreviewFields(
  draft: Partial<CustomerDraft>,
): CustomerVoicePreviewField[] {
  const fields: Array<[string, unknown]> = [
    ["Name", draft.name],
    ["Mobile", draft.mobile],
    ["Address", draft.address],
    ["Type", draft.type],
    ["Udhar limit", draft.udharLimit],
    ["Due date", draft.dueDate],
    ["Promise date", draft.promiseToPayDate],
    ["Notes", draft.notes],
  ];

  return fields.flatMap(([label, value]) => {
    const formatted = formatFieldValue(value);
    return formatted ? [{ label, value: formatted }] : [];
  });
}

export function findCustomerMobileDuplicate(
  draft: Pick<CustomerDraft, "name" | "mobile" | "address">,
  customers: CustomerWithLedger[],
  ignoreCustomerId?: string | null,
): DuplicateCustomerWarning | null {
  const mobile = normaliseCustomerMobile(draft.mobile);
  if (!mobile) return null;
  const warnings = findDuplicateCustomerWarnings(
    { name: draft.name, mobile: draft.mobile, address: draft.address },
    customers,
    ignoreCustomerId,
  );
  return warnings.find((warning) => warning.reason === "mobile") ?? null;
}
