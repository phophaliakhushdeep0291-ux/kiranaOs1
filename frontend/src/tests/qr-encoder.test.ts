import { describe, it, expect } from "vitest";
import { encodeQrMatrix, encodeQrSvg, QrCode, Ecc } from "@/lib/qr/qr-encoder";

// The QR finder pattern is a fixed 7x7 shape that appears (unmasked) in three corners of
// every QR Code. Asserting it independently proves the module-drawing logic is intact —
// it does not depend on the data, ECC, or chosen mask.
const FINDER = [
  [1, 1, 1, 1, 1, 1, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 1, 1, 1, 0, 1],
  [1, 0, 0, 0, 0, 0, 1],
  [1, 1, 1, 1, 1, 1, 1],
];

describe("QR encoder (vendored Nayuki)", () => {
  it("produces a square matrix of the correct size for the chosen version", () => {
    const m = encodeQrMatrix("12345", "M"); // short numeric -> version 1 -> 21x21
    expect(m.length).toBe(21);
    for (const row of m) expect(row.length).toBe(21);
  });

  it("draws the canonical finder pattern in the top-left corner", () => {
    const m = encodeQrMatrix("KIRANA", "M");
    for (let y = 0; y < 7; y++)
      for (let x = 0; x < 7; x++)
        expect(m[y][x]).toBe(FINDER[y][x] === 1);
  });

  it("draws the same finder pattern in the top-right and bottom-left corners", () => {
    const m = encodeQrMatrix("KIRANA", "M");
    const n = m.length;
    for (let y = 0; y < 7; y++) {
      for (let x = 0; x < 7; x++) {
        expect(m[y][n - 7 + x]).toBe(FINDER[y][x] === 1); // top-right
        expect(m[n - 7 + y][x]).toBe(FINDER[y][x] === 1); // bottom-left
      }
    }
  });

  it("draws the alternating timing patterns on row/column 6", () => {
    const m = encodeQrMatrix("KIRANA", "M");
    // Horizontal timing (row 6) in the strip between the finders alternates dark/light.
    expect(m[6][8]).toBe(true);
    expect(m[6][9]).toBe(false);
    expect(m[6][10]).toBe(true);
    // Vertical timing (column 6).
    expect(m[8][6]).toBe(true);
    expect(m[9][6]).toBe(false);
    // The single "always dark" module beside the bottom-left finder (size-8, 8).
    expect(m[m.length - 8][8]).toBe(true);
  });

  it("is deterministic (auto-mask choice is stable for the same input)", () => {
    const a = encodeQrMatrix("hello world", "M");
    const b = encodeQrMatrix("hello world", "M");
    expect(a).toEqual(b);
  });

  it("grows the version (and size) as the payload grows", () => {
    const small = encodeQrMatrix("12345", "L").length;
    const big = encodeQrMatrix("a".repeat(400), "L").length;
    expect(big).toBeGreaterThan(small);
    // Size is always version*4+17, i.e. odd and >= 21.
    expect(small % 2).toBe(1);
    expect(big % 2).toBe(1);
  });

  it("throws when the data cannot fit in any version", () => {
    expect(() => encodeQrMatrix("a".repeat(4000), "H")).toThrow();
  });

  it("renders an SVG with a quiet-zone border and a path of dark modules", () => {
    const svg = encodeQrSvg("12345", { level: "M", border: 4 }); // 21 + 2*4 = 29
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg).toContain('viewBox="0 0 29 29"');
    expect(svg).toContain("<path");
    expect(svg).toContain("</svg>");
  });

  it("omits the background rect when light is transparent", () => {
    const svg = encodeQrSvg("12345", { light: "transparent" });
    expect(svg).not.toContain("<rect");
  });

  it("exposes the low-level API with the four ECC levels", () => {
    for (const ecc of [Ecc.LOW, Ecc.MEDIUM, Ecc.QUARTILE, Ecc.HIGH]) {
      const qr = QrCode.encodeText("test", ecc);
      expect(qr.size).toBeGreaterThanOrEqual(21);
      expect(qr.getModule(0, 0)).toBe(true); // finder corner is dark
      expect(qr.getModule(-1, -1)).toBe(false); // out of bounds is light
    }
  });
});
