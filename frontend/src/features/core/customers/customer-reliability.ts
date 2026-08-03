import type { Customer, CustomerInput } from "@/types/api";

type CustomerSearchable = Pick<Customer, "id" | "name" | "mobile" | "address"> & {
  deletedAt?: string | null;
  deleted_at?: string | null;
};

type CustomerCandidate = Pick<CustomerInput, "name" | "mobile" | "address">;

export interface DuplicateCustomerWarning {
  customerId: string;
  customerName: string;
  reason: "mobile" | "name_address_similarity";
  matchedFields: string[];
  message: string;
}

export function normaliseCustomerText(value: unknown): string {
  return String(value ?? "")
    .trim()
    .toLocaleLowerCase("en-IN")
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normaliseCustomerMobile(value: unknown): string {
  const digits = String(value ?? "").replace(/\D/g, "");
  if (digits.length > 10 && digits.endsWith(digits.slice(-10))) return digits.slice(-10);
  return digits;
}

function tokenise(value: unknown): string[] {
  const text = normaliseCustomerText(value);
  if (!text) return [];
  return text.split(" ").filter((token) => token.length > 1);
}

function tokenOverlapScore(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) return 0;
  const leftSet = new Set(left);
  const rightSet = new Set(right);
  const common = [...leftSet].filter((token) => rightSet.has(token)).length;
  return (2 * common) / (leftSet.size + rightSet.size);
}

function textSimilarity(left: unknown, right: unknown): number {
  const a = normaliseCustomerText(left);
  const b = normaliseCustomerText(right);
  if (!a || !b) return 0;
  if (a === b) return 1;
  if (a.includes(b) || b.includes(a)) return 0.9;
  return tokenOverlapScore(tokenise(a), tokenise(b));
}

function hasNameAddressSimilarity(candidate: CustomerCandidate, existing: CustomerSearchable): boolean {
  const nameScore = textSimilarity(candidate.name, existing.name);
  const candidateAddress = normaliseCustomerText(candidate.address);
  const existingAddress = normaliseCustomerText(existing.address);

  if (nameScore < 0.55) return false;

  // Same or very similar names are enough when one side has no address yet.
  if (!candidateAddress || !existingAddress) return nameScore >= 0.9;

  return textSimilarity(candidateAddress, existingAddress) >= 0.45;
}

export function findDuplicateCustomerWarnings(
  candidate: CustomerCandidate,
  customers: CustomerSearchable[],
  ignoreCustomerId?: string | null,
): DuplicateCustomerWarning[] {
  const candidateMobile = normaliseCustomerMobile(candidate.mobile);
  const warnings: DuplicateCustomerWarning[] = [];

  for (const customer of customers) {
    if (ignoreCustomerId && customer.id === ignoreCustomerId) continue;
    if (customer.deletedAt || customer.deleted_at) continue;

    const existingMobile = normaliseCustomerMobile(customer.mobile);
    if (candidateMobile && existingMobile && candidateMobile === existingMobile) {
      warnings.push({
        customerId: customer.id,
        customerName: customer.name,
        reason: "mobile",
        matchedFields: ["mobile"],
        message: `Duplicate customer: mobile number already exists for ${customer.name}.`,
      });
      continue;
    }

    if (hasNameAddressSimilarity(candidate, customer)) {
      warnings.push({
        customerId: customer.id,
        customerName: customer.name,
        reason: "name_address_similarity",
        matchedFields: ["name", "address"],
        message: `Possible duplicate: ${candidate.name ?? "Customer"} looks similar to existing customer ${customer.name}.`,
      });
    }
  }

  return warnings;
}
