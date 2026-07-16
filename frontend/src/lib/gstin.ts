const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export interface GstinValidation {
  valid: boolean;
  normalized: string;
  stateCode?: string;
  reason?: string;
}

export function validateGstin(value: unknown): GstinValidation {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(normalized)) {
    return { valid: false, normalized, reason: "Enter a valid 15-character GSTIN" };
  }
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const product = GST_CHARS.indexOf(normalized[index]) * ((index % 2) + 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GST_CHARS[(36 - (sum % 36)) % 36];
  if (normalized[14] !== expected) return { valid: false, normalized, reason: "GSTIN checksum is invalid" };
  return { valid: true, normalized, stateCode: normalized.slice(0, 2) };
}

export function gstStateCode(value: unknown): string | undefined {
  const result = validateGstin(value);
  return result.valid ? result.stateCode : undefined;
}
