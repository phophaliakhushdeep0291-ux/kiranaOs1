import { describe, expect, it } from "vitest";
import {
  parseProductVoiceAnswer,
  parseSpokenProductFields,
} from "@/features/core/products/product-voice-parser";
import {
  applyProductVoiceFields,
  isProductReadyToSave,
  nextProductVoiceField,
  readVoiceControlWord,
} from "@/features/core/products/product-voice-session";
import { productFormSchema, type ProductFormData } from "@/features/core/products/pages/product-form-state";
import { parseLocalVoiceIntent, parseProductDraft } from "@/features/core/voice/voice-command-parser";

function emptyForm(overrides: Partial<ProductFormData> = {}): ProductFormData {
  return { ...productFormSchema.parse({ name: "x", sellingPrice: 1 }), name: "", sellingPrice: 0, ...overrides };
}

describe("product voice parser — one natural sentence", () => {
  it("reads every field a full sentence states", () => {
    const fields = parseSpokenProductFields(
      "add product Tata Salt 1 kg MRP 28 cost 24 selling 26 stock 50 GST 5 percent",
    );

    expect(fields).toMatchObject({
      name: "tata salt",
      mrp: 28,
      costPrice: 24,
      sellingPrice: 26,
      stockQuantity: 50,
      gstRate: 5,
      packSizeValue: 1,
      packSizeUnit: "kg",
    });
  });

  // The whole point of consuming tokens: a field label must never survive into
  // the name. Each of these filed a corrupted product name before.
  it.each([
    ["add product Tata Salt 1 kg MRP 28", "tata salt"],
    ["add product basmati rice category grocery unit kg cost 90", "basmati rice"],
    ["new product colgate 100 gram mrp 55 stock 24 pieces", "colgate"],
    ["add product maggi mrp 14 rupees cost 12 rupees", "maggi"],
  ])("keeps field words out of the name: %s", (spoken, name) => {
    expect(parseSpokenProductFields(spoken).name).toBe(name);
  });

  it("keeps a unit word that is part of the name", () => {
    // "G" is gram everywhere except in the name of a biscuit.
    expect(parseSpokenProductFields("add product Parle G brand Parle mrp 10").name).toBe("parle g");
    expect(parseSpokenProductFields("add product Parle G brand Parle mrp 10").brand).toBe("parle");
  });

  it("keeps identifiers as text so leading zeros survive", () => {
    const fields = parseSpokenProductFields("add product amul butter 500 g hsn 0405 barcode 8901262010016");

    expect(fields.hsn).toBe("0405");
    expect(fields.barcode).toBe("8901262010016");
    expect(fields.name).toBe("amul butter");
    expect(fields.packSizeValue).toBe(500);
    expect(fields.packSizeUnit).toBe("gram");
  });

  it("prefers the longer label so cost is never read as the selling price", () => {
    const fields = parseSpokenProductFields("cost price 40 selling price 45 minimum price 42");

    expect(fields).toMatchObject({ costPrice: 40, sellingPrice: 45, minimumSellingPrice: 42 });
  });

  it("takes a repeated field from its first mention and still consumes the rest", () => {
    const fields = parseSpokenProductFields("add product chini selling 45 selling 60");

    expect(fields.sellingPrice).toBe(45);
    expect(fields.name).toBe("chini");
  });

  it("lets an explicit unit beat one inferred from the stock figure", () => {
    expect(parseSpokenProductFields("stock 25 kg unit litre").unit).toBe("litre");
  });
});

describe("product voice parser — Hindi", () => {
  it("reads a Hindi sentence that used to return nothing", () => {
    const fields = parseSpokenProductFields("नया प्रोडक्ट चीनी दाम 45 स्टॉक 20 किलो");

    expect(fields).toMatchObject({ name: "चीनी", sellingPrice: 45, stockQuantity: 20, unit: "kg" });
  });

  it("separates the buying price from the selling price in Hindi", () => {
    const fields = parseSpokenProductFields("चीनी का खरीद दाम 40 बिक्री दाम 45 स्टॉक 20 किलो");

    expect(fields).toMatchObject({ name: "चीनी", costPrice: 40, sellingPrice: 45 });
  });

  it("folds Devanagari digits to numbers", () => {
    expect(parseSpokenProductFields("नया प्रोडक्ट रस्क दाम ४० स्टॉक १०").sellingPrice).toBe(40);
    expect(parseSpokenProductFields("नया प्रोडक्ट रस्क दाम ४० स्टॉक १०").stockQuantity).toBe(10);
  });

  it("reads a price spoken as a word", () => {
    expect(parseSpokenProductFields("naya product rusk daam bees").sellingPrice).toBe(20);
  });

  it("routes a Hindi product command to the product form", () => {
    const intent = parseLocalVoiceIntent("नया प्रोडक्ट चीनी दाम 45 स्टॉक 20 किलो", "/dashboard");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.name).toBe("चीनी");
    expect(intent.product?.sellingPrice).toBe(45);
  });

  it("leaves a Hindi field word alone away from the products screen", () => {
    // खरीद is just as plausibly an inventory purchase, so it only counts as a
    // product field once the form is already open.
    expect(parseLocalVoiceIntent("खरीद 40", "/dashboard").action).not.toBe("product_draft");
    expect(parseLocalVoiceIntent("खरीद 40", "/products").action).toBe("product_draft");
  });
});

describe("product voice draft for the floating assistant", () => {
  it("carries the fields the product form can already accept", () => {
    const draft = parseProductDraft("add product amul butter 500 g mrp 265 gst 12 brand amul");

    expect(draft).toMatchObject({ mode: "create", productName: "amul butter", mrp: 265, gstRate: 12, brand: "amul" });
  });

  it("marks an edit command as an edit", () => {
    expect(parseProductDraft("update product chini selling 50").mode).toBe("edit");
  });
});

describe("answering one question at a time", () => {
  it("reads a bare number as the field being asked for", () => {
    expect(parseProductVoiceAnswer("mrp", "28")).toEqual({ mrp: 28 });
    expect(parseProductVoiceAnswer("stockQuantity", "50 kg")).toMatchObject({ stockQuantity: 50, unit: "kg" });
  });

  it("takes a named field as a correction instead of the pending answer", () => {
    // Asked for the selling price, told the cost — the words win over the slot.
    expect(parseProductVoiceAnswer("sellingPrice", "cost is 24")).toEqual({ costPrice: 24 });
  });

  it("reads a bare name without needing the word name", () => {
    expect(parseProductVoiceAnswer("name", "tata salt")).toEqual({ name: "tata salt" });
  });

  it("returns nothing when the answer holds no value for the field", () => {
    expect(parseProductVoiceAnswer("mrp", "hmm")).toEqual({});
  });

  it("recognises conversation commands only when they are the whole utterance", () => {
    expect(readVoiceControlWord("skip")).toBe("skip");
    expect(readVoiceControlWord("छोड़ो")).toBe("skip");
    expect(readVoiceControlWord("save")).toBe("save");
    expect(readVoiceControlWord("bas")).toBe("stop");
    // A product whose name contains a command word must not end the session.
    expect(readVoiceControlWord("sarson ka tel save")).toBe("none");
  });
});

describe("what to ask next", () => {
  it("asks for the two fields the form cannot save without, in order", () => {
    const handled = new Set<never>();
    expect(nextProductVoiceField(emptyForm(), handled)).toBe("name");
    expect(nextProductVoiceField(emptyForm({ name: "chini" }), handled)).toBe("sellingPrice");
  });

  it("skips what the sentence already answered", () => {
    const values = emptyForm({ name: "chini", sellingPrice: 45, mrp: 50 });

    expect(nextProductVoiceField(values, new Set())).toBe("costPrice");
  });

  it("stops asking once the worthwhile fields are handled", () => {
    const values = emptyForm({ name: "chini", sellingPrice: 45 });
    const handled = new Set(["mrp", "costPrice", "stockQuantity"] as const);

    expect(nextProductVoiceField(values, handled)).toBeNull();
    expect(isProductReadyToSave(values)).toBe(true);
  });

  it("asks again for a required field that was skipped", () => {
    // Skipping the selling price would otherwise just move the failure to Save.
    const handled = new Set(["name", "sellingPrice", "mrp", "costPrice", "stockQuantity"] as const);

    expect(nextProductVoiceField(emptyForm({ name: "chini" }), handled)).toBe("sellingPrice");
    expect(isProductReadyToSave(emptyForm({ name: "chini" }))).toBe(false);
  });
});

describe("folding voice into the product form", () => {
  it("fills the form from one sentence and leaves it saveable", () => {
    const spoken = "add product Tata Salt 1 kg MRP 28 cost 24 selling 26 stock 50 GST 5 percent";
    const values = applyProductVoiceFields(emptyForm(), parseSpokenProductFields(spoken));

    expect(values).toMatchObject({
      name: "tata salt",
      mrp: 28,
      costPrice: 24,
      sellingPrice: 26,
      stockQuantity: 50,
      gstRate: 5,
      packSizeValue: 1,
      packSizeUnit: "kg",
    });
    expect(productFormSchema.safeParse(values).success).toBe(true);
    expect(isProductReadyToSave(values)).toBe(true);
  });

  it("drops a pack unit the form's own picker does not offer", () => {
    // The number is still worth keeping; writing "box" would leave the picker
    // showing an empty selection for the shop to fix by hand.
    const values = applyProductVoiceFields(emptyForm(), { packSizeValue: 2, packSizeUnit: "box" });

    expect(values.packSizeValue).toBe(2);
    expect(values.packSizeUnit).toBe("piece");
  });

  it("leaves untouched fields exactly as they were", () => {
    const base = emptyForm({ name: "chini", category: "grocery", gstRate: 12 });
    const values = applyProductVoiceFields(base, { sellingPrice: 45 });

    expect(values.category).toBe("grocery");
    expect(values.gstRate).toBe(12);
    expect(values.sellingPrice).toBe(45);
  });
});
