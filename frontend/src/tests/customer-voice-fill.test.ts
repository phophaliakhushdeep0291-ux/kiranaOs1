import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parseCustomerDraft,
  parseLocalVoiceIntent,
} from "@/features/voice/voice-command-parser";
import {
  buildCustomerVoicePreviewFields,
  findCustomerMobileDuplicate,
} from "@/features/customers/customer-voice-fill";
import type { CustomerWithLedger } from "@/features/customers/customer-ledger-data";

const existingCustomer: CustomerWithLedger = {
  id: "customer_ramesh",
  name: "Ramesh Kirana",
  mobile: "9876543210",
  address: "Sardarpura",
  type: "udhar",
  ledgerBalance: 1200,
  ledgerMetrics: {
    trustScore: 80,
    isBadCustomer: false,
    warning: null,
    lastPaymentAt: null,
    overdueDays: 0,
    unpaidBills: 0,
    paidBills: 0,
    totalCredit: 1200,
    totalPayments: 0,
  },
  createdAt: "2026-06-01T00:00:00.000Z",
  updatedAt: "2026-06-01T00:00:00.000Z",
};

afterEach(() => {
  vi.useRealTimers();
});

describe("customer voice fill", () => {
  it("parses add customer name and mobile", () => {
    const draft = parseCustomerDraft("add customer Ramesh mobile 9876543210");

    expect(draft.name).toBe("Ramesh");
    expect(draft.mobile).toBe("9876543210");
    expect(draft.mode).toBe("create");
  });

  it("parses address field command", () => {
    const draft = parseCustomerDraft("address Sardarpura");

    expect(draft.address).toBe("Sardarpura");
    expect(draft.name).toBeUndefined();
  });

  it("parses udhar limit and marks customer as udhar", () => {
    const draft = parseCustomerDraft("udhar limit 5000");

    expect(draft.udharLimit).toBe(5000);
    expect(draft.type).toBe("udhar");
  });

  it("parses promise date next Friday", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-06T09:00:00.000Z"));

    const draft = parseCustomerDraft("promise date next Friday");

    expect(draft.promiseToPayDate).toBe("2026-06-12");
  });

  it("routes customer field-only commands to customer draft when form is open", () => {
    const intent = parseLocalVoiceIntent("name Ramesh", "/customers");

    expect(intent.action).toBe("customer_draft");
    expect(intent.route).toBe("/customers");
    expect(intent.customer?.name).toBe("Ramesh");
  });

  it("opens customer form from standalone address command", () => {
    const intent = parseLocalVoiceIntent("address Sardarpura", "/dashboard");

    expect(intent.action).toBe("customer_draft");
    expect(intent.route).toBe("/customers");
    expect(intent.customer?.address).toBe("Sardarpura");
  });

  it("shows interpreted preview fields for customer voice draft", () => {
    const draft = parseCustomerDraft(
      "add customer Ramesh mobile 9876543210 address Sardarpura udhar limit 5000",
    );
    const fields = buildCustomerVoicePreviewFields(draft);

    expect(fields).toEqual(
      expect.arrayContaining([
        { label: "Name", value: "Ramesh" },
        { label: "Mobile", value: "9876543210" },
        { label: "Address", value: "Sardarpura" },
        { label: "Type", value: "udhar" },
        { label: "Udhar limit", value: "5000" },
      ]),
    );
  });

  it("detects existing customer by mobile before save", () => {
    const duplicate = findCustomerMobileDuplicate(
      { name: "Ramesh", mobile: "+91 98765 43210", address: "Sardarpura" },
      [existingCustomer],
    );

    expect(duplicate).toEqual(
      expect.objectContaining({
        customerId: "customer_ramesh",
        customerName: "Ramesh Kirana",
        reason: "mobile",
      }),
    );
  });

  it("does not mark same edited customer as duplicate", () => {
    const duplicate = findCustomerMobileDuplicate(
      { name: "Ramesh Kirana", mobile: "9876543210", address: "Sardarpura" },
      [existingCustomer],
      "customer_ramesh",
    );

    expect(duplicate).toBeNull();
  });

  it("does not auto-save from voice command", () => {
    const intent = parseLocalVoiceIntent(
      "add customer Ramesh mobile 9876543210",
      "/dashboard",
    );

    expect(intent.action).toBe("customer_draft");
    expect(intent.requiresConfirmation).toBeUndefined();
    expect(intent.requiresOwnerPin).toBeUndefined();
    expect(intent.customer).toEqual(
      expect.objectContaining({ name: "Ramesh", mobile: "9876543210" }),
    );
  });
});
