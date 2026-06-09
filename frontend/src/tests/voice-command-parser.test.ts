import { describe, expect, it } from "vitest";
import {
  normalizeAiIntent,
  parseCustomerDraft,
  parseInventoryDraft,
  parseLocalVoiceIntent,
  parseProductDraft,
  parseQuantityUnit,
} from "@/features/voice/voice-command-parser";

describe("voice command parser", () => {
  it("parses product drafts from local voice commands", () => {
    const draft = parseProductDraft("add product chini cost 40 selling 45 stock 10 kg alias sugar cheeni");

    expect(draft.mode).toBe("create");
    expect(draft.name).toBe("chini");
    expect(draft.productName).toBe("chini");
    expect(draft.costPrice).toBe(40);
    expect(draft.sellingPrice).toBe(45);
    expect(draft.stockQuantity).toBe(10);
    expect(draft.aliases).toEqual(expect.arrayContaining(["sugar", "cheeni"]));
  });

  it("parses customer drafts with mobile and udhar details", () => {
    const draft = parseCustomerDraft("add customer Ramesh mobile 9876543210 address sardarpura udhar limit 5000");

    expect(draft.mode).toBe("create");
    expect(draft.name).toBe("Ramesh");
    expect(draft.mobile).toBe("9876543210");
    expect(draft.type).toBe("udhar");
    expect(draft.udharLimit).toBe(5000);
  });

  it("parses inventory purchase commands with quantity and cost", () => {
    const draft = parseInventoryDraft("purchase 10 kilo chini cost 40 supplier Mohan bill amount 400");

    expect(draft.movementType).toBe("purchase");
    expect(draft.quantity).toBe(10);
    expect(draft.costPrice).toBe(40);
    expect(draft.billAmount).toBe(400);
  });

  it("normalizes common voice quantity units", () => {
    expect(parseQuantityUnit("2 kilo sugar")).toEqual({ quantity: 2, unit: "kg" });
    expect(parseQuantityUnit("500 gm sugar")).toEqual({ quantity: 500, unit: "gram" });
    expect(parseQuantityUnit("3 pcs soap")).toEqual({ quantity: 3, unit: "piece" });
  });

  it("routes product field commands to the current products page", () => {
    const intent = parseLocalVoiceIntent("selling price 45 minimum 42", "/products");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.sellingPrice).toBe(45);
    expect(intent.product?.minimumSellingPrice).toBe(42);
  });

  it("keeps billing voice commands on the billing flow", () => {
    const intent = parseLocalVoiceIntent("2 kg chini 90 rupay naam Ramesh", "/dashboard");

    expect(intent.action).toBe("billing_command");
    expect(intent.route).toBe("/billing");
    expect(intent.billingCommand).toBe("2 kg chini 90 rupay naam Ramesh");
  });

  it("normalizes backend AI intent safely", () => {
    const intent = normalizeAiIntent({
      action: "product_draft",
      route: "/products",
      product_draft: {
        name: "atta",
        cost_price: "30",
        selling_price: 35,
        aliases: ["flour", "aata"],
      },
      message: "Opening product form with your voice details.",
    });

    expect(intent?.action).toBe("product_draft");
    expect(intent?.route).toBe("/products");
    expect(intent?.product?.name).toBe("atta");
    expect(intent?.product?.costPrice).toBe(30);
    expect(intent?.product?.sellingPrice).toBe(35);
    expect(intent?.product?.aliases).toEqual(["flour", "aata"]);
  });
});
