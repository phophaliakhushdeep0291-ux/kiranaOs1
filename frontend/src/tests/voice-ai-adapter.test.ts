import { describe, expect, it } from "vitest";
import { adaptBackendCommandIntent } from "@/features/voice/voice-ai-client";

// The backend POST /ai/parse-command returns a shop/billing-oriented schema.
// adaptBackendCommandIntent must translate the safely-mappable intents into the
// app's VoiceIntent and return null (→ local-parser fallback) for anything
// ambiguous, low-confidence, or destructive.
describe("adaptBackendCommandIntent", () => {
  it("maps SEARCH_PRODUCT (with items) to a product search intent", () => {
    const intent = adaptBackendCommandIntent(
      { intent: "SEARCH_PRODUCT", confidence: 0.9, items: [{ query: "chini" }] },
      "search product chini",
    );
    expect(intent).toMatchObject({ action: "search", route: "/products", search: { target: "product", query: "chini" } });
  });

  it("maps SET_CUSTOMER to a customer_draft (edit) with name/mobile", () => {
    const intent = adaptBackendCommandIntent(
      { intent: "SET_CUSTOMER", confidence: 0.8, customer: { name: "Ramesh", mobile: "9876543210" } },
      "set customer Ramesh",
    );
    expect(intent).toMatchObject({ action: "customer_draft", customer: { mode: "edit", name: "Ramesh", mobile: "9876543210" } });
  });

  it("maps billing intents to a billing_command carrying the raw transcript, confirmation required", () => {
    const intent = adaptBackendCommandIntent(
      { intent: "ADD_ITEMS", confidence: 0.95, items: [{ query: "sugar", quantity: 2, unit: "kg" }] },
      "do kilo chini add karo",
    );
    expect(intent).toMatchObject({ action: "billing_command", route: "/billing", billingCommand: "do kilo chini add karo", requiresConfirmation: true });
  });

  it("maps SHOW_KHATA / OPEN_REPORTS to navigation", () => {
    expect(adaptBackendCommandIntent({ intent: "SHOW_KHATA", confidence: 0.9 }, "khata")).toMatchObject({ action: "navigate", route: "/udhar" });
    expect(adaptBackendCommandIntent({ intent: "OPEN_REPORTS", confidence: 0.9 }, "reports")).toMatchObject({ action: "navigate", route: "/reports" });
  });

  it("defers to the local parser (null) when clarification is needed or confidence is low", () => {
    expect(adaptBackendCommandIntent({ intent: "ADD_ITEMS", clarificationNeeded: true }, "kuch add karo")).toBeNull();
    expect(adaptBackendCommandIntent({ intent: "SEARCH_PRODUCT", confidence: 0.2, items: [{ query: "x" }] }, "x")).toBeNull();
    expect(adaptBackendCommandIntent({ intent: "SEARCH_PRODUCT", items: [{ query: "x" }] }, "x")).toBeNull();
  });

  it("fails closed when backend grounding or permissions reject the model output", () => {
    expect(adaptBackendCommandIntent({
      intent: "ADD_ITEMS",
      confidence: 0.95,
      permissionAllowed: false,
      items: [{ query: "sugar" }],
    }, "add sugar")).toBeNull();
    expect(adaptBackendCommandIntent({
      intent: "SEARCH_PRODUCT",
      confidence: 0.95,
      safety: { schemaValid: false },
      items: [{ query: "sugar" }],
    }, "search sugar")).toBeNull();
    expect(adaptBackendCommandIntent({
      intent: "SEARCH_PRODUCT",
      confidence: 0.95,
      safety: { requiresManualFallback: true },
      items: [{ query: "sugar" }],
    }, "search sugar")).toBeNull();
  });

  it("returns null for unknown and destructive intents (never auto-executed)", () => {
    expect(adaptBackendCommandIntent({ intent: "UNKNOWN", confidence: 0.9 }, "blah")).toBeNull();
    expect(adaptBackendCommandIntent({ intent: "CANCEL_BILL", confidence: 0.9 }, "cancel bill 5")).toBeNull();
    expect(adaptBackendCommandIntent({ intent: "DELETE_PRODUCT", confidence: 0.9 }, "delete chini")).toBeNull();
  });

  it("returns null for non-object / shapeless responses", () => {
    expect(adaptBackendCommandIntent(null, "x")).toBeNull();
    expect(adaptBackendCommandIntent("oops", "x")).toBeNull();
    expect(adaptBackendCommandIntent({ confidence: 0.9 }, "x")).toBeNull();
  });
});
