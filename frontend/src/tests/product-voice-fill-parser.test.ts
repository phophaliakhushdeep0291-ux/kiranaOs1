import { describe, expect, it } from "vitest";
import { parseLocalVoiceIntent, parseProductDraft } from "@/features/voice/voice-command-parser";

describe("product voice fill parser", () => {
  it("parses product name commands", () => {
    expect(parseProductDraft("add product chini").name).toBe("chini");
    expect(parseProductDraft("name chini").name).toBe("chini");
  });

  it("parses category commands", () => {
    const draft = parseProductDraft("category grocery");

    expect(draft.category).toBe("grocery");
    expect(draft.name).toBeUndefined();
  });

  it("parses cost, selling, and minimum prices", () => {
    const draft = parseProductDraft("cost 40 selling 45 minimum 42");

    expect(draft.costPrice).toBe(40);
    expect(draft.sellingPrice).toBe(45);
    expect(draft.minimumSellingPrice).toBe(42);
    expect(draft.stockQuantity).toBeUndefined();
  });

  it("parses stock and unit", () => {
    const draft = parseProductDraft("stock 20 kg");

    expect(draft.stockQuantity).toBe(20);
    expect(draft.unit).toBe("kg");
  });

  it("parses retail and wholesale slab prices", () => {
    const retail = parseProductDraft("retail 45 from 1 kg");
    const wholesale = parseProductDraft("wholesale 42 from 10 kg");

    expect(retail.retailPrice).toBe(45);
    expect(retail.retailFromQuantity).toBe(1);
    expect(wholesale.wholesalePrice).toBe(42);
    expect(wholesale.wholesaleFromQuantity).toBe(10);
  });

  it("parses aliases across Hindi, Hinglish, and English without duplicates", () => {
    const draft = parseProductDraft("alias sugar cheeni shakar sakar चीनी शक्कर sugar");

    expect(draft.aliases).toEqual(["sugar", "cheeni", "shakar", "sakar", "चीनी", "शक्कर"]);
  });

  it("routes product field-only commands to product draft instead of auto-save", () => {
    const intent = parseLocalVoiceIntent("selling 45 minimum 42", "/dashboard");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.sellingPrice).toBe(45);
    expect(intent.product?.minimumSellingPrice).toBe(42);
    expect(intent.requiresConfirmation).toBeUndefined();
    expect(intent.requiresOwnerPin).toBeUndefined();
  });

  it("keeps form-open product field commands on the product draft flow", () => {
    const intent = parseLocalVoiceIntent("unit kg", "/products");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.unit).toBe("kg");
    expect(intent.product?.name).toBeUndefined();
  });
});
