/**
 * EAN-13 barcode encoder — pure, dependency-free (vendust like the QR encoder).
 *
 * An EAN-13 symbol is 95 modules wide: start guard (101), six left digits
 * (odd/even parity chosen by the leading digit), centre guard (01010), six
 * right digits (all R-codes), end guard (101). The 13th input digit is the
 * checksum; `normalizeEan13` accepts 12 digits (computes it) or 13 digits
 * (verifies it), plus UPC-A (11/12 digits, zero-prefixed to EAN-13).
 */

/** L-codes for digits 0–9. G = L reversed; R = L complemented. */
const L_CODES = [
  "0001101", "0011001", "0010011", "0111101", "0100011",
  "0110001", "0101111", "0111011", "0110111", "0001011",
] as const;

/** Parity of the six left digits, selected by the (implicit) first digit. */
const PARITY = [
  "OOOOOO", "OOEOEE", "OOEEOE", "OOEEEO", "OEOOEE",
  "OEEOOE", "OEEEOO", "OEOEOE", "OEOEEO", "OEEOEO",
] as const;

function gCode(digit: number): string {
  return L_CODES[digit].split("").reverse().join("");
}

function rCode(digit: number): string {
  return L_CODES[digit].replace(/[01]/g, (bit) => (bit === "0" ? "1" : "0"));
}

/** EAN-13 checksum for the first 12 digits. */
export function ean13CheckDigit(first12: string): number {
  const sum = first12.split("").reduce(
    (acc, char, index) => acc + Number(char) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10;
}

/**
 * Coerce a raw product barcode into a full 13-digit EAN-13, or null when the
 * content cannot be an EAN-13 (non-digits, wrong length, bad check digit).
 */
export function normalizeEan13(raw: string | null | undefined): string | null {
  const digits = String(raw ?? "").trim();
  if (!/^\d+$/.test(digits)) return null;
  if (digits.length === 12) {
    // Could be a 12-digit EAN body (check missing) OR a full UPC-A. Prefer the
    // interpretation whose check digit validates as UPC-A; else treat as body.
    const asUpcA = `0${digits}`;
    if (ean13CheckDigit(asUpcA.slice(0, 12)) === Number(asUpcA[12])) return asUpcA;
    return digits + String(ean13CheckDigit(digits));
  }
  if (digits.length === 11) {
    const upcBody = `0${digits}`;
    return upcBody + String(ean13CheckDigit(upcBody));
  }
  if (digits.length === 13) {
    return ean13CheckDigit(digits.slice(0, 12)) === Number(digits[12]) ? digits : null;
  }
  return null;
}

/** 95-character "1"/"0" module string for a full (already normalized) EAN-13. */
export function ean13Modules(ean13: string): string {
  if (!/^\d{13}$/.test(ean13)) throw new Error("ean13Modules expects 13 digits");
  const digits = ean13.split("").map(Number);
  const parity = PARITY[digits[0]];
  let modules = "101";
  for (let i = 1; i <= 6; i += 1) {
    modules += parity[i - 1] === "O" ? L_CODES[digits[i]] : gCode(digits[i]);
  }
  modules += "01010";
  for (let i = 7; i <= 12; i += 1) {
    modules += rCode(digits[i]);
  }
  modules += "101";
  return modules;
}

export interface Ean13SvgOptions {
  /** Width of one module in SVG units (default 1). */
  moduleWidth?: number;
  /** Bar height in SVG units (default 40). */
  height?: number;
  /** Include the human-readable digits under the bars (default true). */
  showDigits?: boolean;
}

/** Standalone SVG for a normalized EAN-13 (call normalizeEan13 first). */
export function ean13Svg(ean13: string, options: Ean13SvgOptions = {}): string {
  const moduleWidth = options.moduleWidth ?? 1;
  const height = options.height ?? 40;
  const showDigits = options.showDigits !== false;
  const modules = ean13Modules(ean13);
  const textSpace = showDigits ? 10 : 0;
  const width = 95 * moduleWidth;
  let bars = "";
  let runStart = -1;
  for (let i = 0; i <= modules.length; i += 1) {
    const isBar = i < modules.length && modules[i] === "1";
    if (isBar && runStart < 0) runStart = i;
    if (!isBar && runStart >= 0) {
      bars += `<rect x="${runStart * moduleWidth}" y="0" width="${(i - runStart) * moduleWidth}" height="${height}"/>`;
      runStart = -1;
    }
  }
  const text = showDigits
    ? `<text x="${width / 2}" y="${height + 9}" text-anchor="middle" font-family="monospace" font-size="9">${ean13}</text>`
    : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height + textSpace}" width="${width}" height="${height + textSpace}" fill="#000">${bars}${text}</svg>`;
}
