import { describe, expect, it } from "vitest";
import { packClashReason } from "@/features/core/products/pages/components/ProductFormPanel";

/**
 * Adding a second pack size must never produce two rows a shopkeeper cannot tell apart.
 *
 * Both ways of creating that pair used to go straight onto the product, because the
 * only check compared `unitCode` strings and the barcode box had no check at all.
 */

const kiloPacket = { unitType: "packet", unitCode: "packet-1-kg", conversionToBase: 1000, barcode: null };

describe("the same physical pack, entered twice", () => {
  it("rejects 1000 gram when a 1 kg packet is already on the product", () => {
    // Different code, identical packet: in per-pack mode this splits the stock
    // across two shelves and puts two identical lines on the bill screen.
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-1000-gram", conversionToBase: 1000 },
      [kiloPacket],
    )).toBe("size");
  });

  it("rejects the exact same code", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-1-kg", conversionToBase: 1000 },
      [kiloPacket],
    )).toBe("size");
  });

  it("allows a genuinely different size", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000 },
      [kiloPacket],
    )).toBeNull();
  });

  it("allows the same size under a different unit type", () => {
    // A BOX holding 1 kg and a PACKET holding 1 kg are two things to stock and to
    // sell, and plenty of shops carry both.
    expect(packClashReason(
      { unitType: "box", unitCode: "box-1-kg", conversionToBase: 1000 },
      [kiloPacket],
    )).toBeNull();
  });

  it("ignores a row with no conversion rather than matching everything to it", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000 },
      [{ unitType: "packet", unitCode: "packet-broken", conversionToBase: 0 }],
    )).toBeNull();
  });
});

describe("one barcode names one pack", () => {
  it("rejects a barcode already on another pack", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000, barcode: "8901234567890" },
      [{ ...kiloPacket, barcode: "8901234567890" }],
    )).toBe("barcode");
  });

  it("rejects the product's own barcode", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000, barcode: "8901234567890" },
      [kiloPacket],
      "8901234567890",
    )).toBe("barcode");
  });

  it("ignores surrounding whitespace on both sides", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000, barcode: "  8901234567890 " },
      [{ ...kiloPacket, barcode: "8901234567890  " }],
    )).toBe("barcode");
  });

  it("lets a pack through with its own barcode", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000, barcode: "8909999999999" },
      [{ ...kiloPacket, barcode: "8901234567890" }],
      "8901234567890",
    )).toBeNull();
  });

  it("treats a blank barcode as no claim, however many packs leave it blank", () => {
    // Most packs never get a barcode of their own; empty must not collide with empty.
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-5-kg", conversionToBase: 5000, barcode: "   " },
      [kiloPacket, { unitType: "packet", unitCode: "packet-500-gram", conversionToBase: 500, barcode: "" }],
    )).toBeNull();
  });
});

describe("a size clash outranks a barcode clash", () => {
  it("reports the size, which is the thing the shopkeeper must change", () => {
    expect(packClashReason(
      { unitType: "packet", unitCode: "packet-1000-gram", conversionToBase: 1000, barcode: "8901234567890" },
      [{ ...kiloPacket, barcode: "8901234567890" }],
    )).toBe("size");
  });
});
