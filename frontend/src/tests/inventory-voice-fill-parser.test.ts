import { describe, expect, it } from "vitest";
import {
  parseInventoryDraft,
  parseLocalVoiceIntent,
} from "@/features/voice/voice-command-parser";

describe("inventory voice fill parser", () => {
  it("parses purchase commands", () => {
    const draft = parseInventoryDraft("purchase 10 kilo chini cost 40 supplier Mohan");

    expect(draft.movementType).toBe("purchase");
    expect(draft.productName).toBe("chini");
    expect(draft.quantity).toBe(10);
    expect(draft.unit).toBe("kg");
    expect(draft.costPrice).toBe(40);
    expect(draft.supplierName).toBe("Mohan");
  });

  it("parses damage commands", () => {
    const draft = parseInventoryDraft("damage 2 packet oil reason broken packet");

    expect(draft.movementType).toBe("damage");
    expect(draft.productName).toBe("oil");
    expect(draft.quantity).toBe(2);
    expect(draft.unit).toBe("packet");
  });

  it("parses correction commands and marks owner PIN requirement", () => {
    const intent = parseLocalVoiceIntent("correction sugar stock 50 kilo");

    expect(intent.action).toBe("inventory_draft");
    expect(intent.inventory?.movementType).toBe("correction");
    expect(intent.inventory?.productName).toBe("sugar");
    expect(intent.inventory?.quantity).toBe(50);
    expect(intent.inventory?.unit).toBe("kg");
    expect(intent.requiresOwnerPin).toBe(true);
  });

  it("parses damage reason without dropping unit words", () => {
    const draft = parseInventoryDraft("damage 2 packet oil reason broken packet");

    expect(draft.reason).toBe("broken packet");
  });

  it("parses supplier name", () => {
    const draft = parseInventoryDraft("purchase 10 kilo chini cost 40 supplier Mohan");

    expect(draft.supplierName).toBe("Mohan");
  });

  it("parses unit and quantity", () => {
    const purchase = parseInventoryDraft("purchase 10 kilo chini cost 40");
    const damage = parseInventoryDraft("damage 2 packet oil reason broken packet");

    expect(purchase.quantity).toBe(10);
    expect(purchase.unit).toBe("kg");
    expect(damage.quantity).toBe(2);
    expect(damage.unit).toBe("packet");
  });

  it("prepares inventory draft and does not auto-save", () => {
    const intent = parseLocalVoiceIntent("purchase 10 kilo chini cost 40 supplier Mohan");

    expect(intent.action).toBe("inventory_draft");
    expect(intent.route).toBe("/inventory");
    expect(intent.requiresConfirmation).toBe(true);
    expect(intent.auditable).toBe(true);
  });
});
