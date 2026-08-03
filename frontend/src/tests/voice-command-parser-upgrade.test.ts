import { describe, expect, it } from "vitest";
import { normalizeAiIntent, parseLocalVoiceIntent, parsePaymentDraft } from "@/features/core/voice/voice-command-parser";

describe("upgraded global voice assistant local intents", () => {
  it.each([
    ["open dashboard", "/dashboard"],
    ["open billing", "/billing"],
    ["open products", "/products"],
    ["open inventory", "/inventory"],
    ["open customers", "/customers"],
    ["open udhar", "/udhar"],
    ["open reports", "/reports"],
  ])("routes %s", (command, route) => {
    const intent = parseLocalVoiceIntent(command);

    expect(intent.action).toBe("navigate");
    expect(intent.route).toBe(route);
  });

  it("creates product draft instead of saving product", () => {
    const intent = parseLocalVoiceIntent("create product chini cost 40 selling 45 stock 10 kg alias sugar cheeni");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.name).toBe("chini");
    expect(intent.product?.costPrice).toBe(40);
    expect(intent.product?.sellingPrice).toBe(45);
    expect(intent.product?.stockQuantity).toBe(10);
  });

  it("fills open product form when already on products", () => {
    const intent = parseLocalVoiceIntent("selling 48 minimum 42 barcode 12345", "/products");

    expect(intent.action).toBe("product_draft");
    expect(intent.route).toBe("/products");
    expect(intent.product?.sellingPrice).toBe(48);
    expect(intent.product?.minimumSellingPrice).toBe(42);
  });

  it("creates customer draft and fills customer fields", () => {
    const intent = parseLocalVoiceIntent("create customer Ramesh mobile 9876543210 address sardarpura udhar limit 5000");

    expect(intent.action).toBe("customer_draft");
    expect(intent.route).toBe("/customers");
    expect(intent.customer?.name).toBe("Ramesh");
    expect(intent.customer?.mobile).toBe("9876543210");
    expect(intent.customer?.type).toBe("udhar");
    expect(intent.customer?.udharLimit).toBe(5000);
  });

  it.each([
    ["purchase 10 kilo chini cost 40 supplier Mohan", "purchase"],
    ["damage 2 packet biscuit reason expired", "damage"],
    ["stock correction chini quantity 5 reason physical count", "correction"],
  ] as const)("creates %s inventory draft", (command, movementType) => {
    const intent = parseLocalVoiceIntent(command);

    expect(intent.action).toBe("inventory_draft");
    expect(intent.route).toBe("/inventory");
    expect(intent.inventory?.movementType).toBe(movementType);
    expect(intent.requiresConfirmation).toBe(true);
    if (movementType === "correction") expect(intent.requiresOwnerPin).toBe(true);
  });

  it("creates billing draft/cart command instead of saving bill", () => {
    const intent = parseLocalVoiceIntent("2 kg chini 90 rupay naam Ramesh", "/dashboard");

    expect(intent.action).toBe("billing_command");
    expect(intent.route).toBe("/billing");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it("creates record payment draft and requires review", () => {
    const draft = parsePaymentDraft("record payment Ramesh 500 upi note old udhar");
    const intent = parseLocalVoiceIntent("record payment Ramesh 500 upi note old udhar");

    expect(draft.customerName).toBe("Ramesh");
    expect(draft.amount).toBe(500);
    expect(draft.mode).toBe("upi");
    expect(intent.action).toBe("payment_draft");
    expect(intent.route).toBe("/udhar");
    expect(intent.requiresConfirmation).toBe(true);
  });

  it.each([
    ["search product chini", "product", "/products"],
    ["find customer Ramesh", "customer", "/customers"],
    ["search bill B-100", "bill", "/bills"],
    ["search udhar Mohan", "udhar", "/udhar"],
  ] as const)("parses search command %s", (command, target, route) => {
    const intent = parseLocalVoiceIntent(command);

    expect(intent.action).toBe("search");
    expect(intent.search?.target).toBe(target);
    expect(intent.route).toBe(route);
    expect(intent.search?.query).toBeTruthy();
  });

  it("answers dashboard summary intent", () => {
    const intent = parseLocalVoiceIntent("ask dashboard summary");

    expect(intent.action).toBe("dashboard_summary");
    expect(intent.route).toBe("/dashboard");
  });

  it("answers pending sync count intent", () => {
    const intent = parseLocalVoiceIntent("ask pending sync count");

    expect(intent.action).toBe("sync_count");
  });

  it("normalizes backend proxy payment and search intents", () => {
    const payment = normalizeAiIntent({ action: "payment_draft", payment_draft: { customer_name: "Sita", amount: "250", mode: "upi" } });
    const search = normalizeAiIntent({ action: "search", search: { target: "customer", query: "Sita" } });

    expect(payment?.action).toBe("payment_draft");
    expect(payment?.payment?.customerName).toBe("Sita");
    expect(payment?.payment?.amount).toBe(250);
    expect(search?.action).toBe("search");
    expect(search?.route).toBe("/customers");
  });
});
