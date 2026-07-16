const GST_CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

export function validateGstin(value) {
  const gstin = String(value || "").trim().toUpperCase();
  if (!/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { valid: false, normalized: gstin, reason: "GSTIN must be a valid 15-character Indian GST number" };
  }
  let sum = 0;
  for (let index = 0; index < 14; index += 1) {
    const codePoint = GST_CHARS.indexOf(gstin[index]);
    const product = codePoint * ((index % 2) + 1);
    sum += Math.floor(product / 36) + (product % 36);
  }
  const expected = GST_CHARS[(36 - (sum % 36)) % 36];
  if (gstin[14] !== expected) return { valid: false, normalized: gstin, reason: "GSTIN checksum is invalid" };
  return { valid: true, normalized: gstin, stateCode: gstin.slice(0, 2), pan: gstin.slice(2, 12) };
}

export function validateHsn(value) {
  const hsn = String(value || "").trim();
  return { valid: /^\d{4}(?:\d{2})?(?:\d{2})?$/.test(hsn), normalized: hsn };
}
