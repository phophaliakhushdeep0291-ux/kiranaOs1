// Preserve the public numeric contract for safe paise values; larger integers
// remain exact decimal strings instead of becoming rounded JSON numbers.
export function apiJsonReplacer(_key, value) {
  if (typeof value !== "bigint") return value;
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}
