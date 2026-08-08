import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildBillReceiptText } from "@/features/core/bills/share";

describe("one-tap bill WhatsApp", () => {
  it("formats Hindi-first preview fields and exact previous udhar", () => {
    const text = buildBillReceiptText({ shopName: "राम किराना", billNo: "K-42", items: [], total: 123.45, paid: 123.45, credit: 0, previousUdhar: 67.89, showPreviousUdhar: true });
    expect(text.split("\n")[0]).toContain("राम किराना से आपका बिल");
    expect(text).toContain("बिल नंबर: K-42");
    expect(text).toContain("पिछला उधार: ₹67.89");
  });
});

describe("offline WhatsApp intent", () => {
  const values = new Map<string, string>();
  beforeEach(() => {
    values.clear();
    vi.stubGlobal("localStorage", { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => values.set(key, value) });
    vi.stubGlobal("window", { addEventListener: vi.fn(), open: vi.fn() });
    vi.stubGlobal("navigator", { onLine: false });
    vi.resetModules();
  });

  it("deduplicates offline clicks and flushes exactly once", async () => {
    const mod = await import("@/features/core/bills/whatsapp-delivery");
    const intent = { billId: "b1", idempotencyKey: "bill-share-1", showGst: true, showPreviousUdhar: true, input: { shopName: "Shop", billNo: "1", items: [], total: 1, paid: 1, credit: 0 } };
    await mod.deliverBillWhatsapp(intent);
    await mod.deliverBillWhatsapp(intent);
    expect(mod.queuedBillWhatsappIntents()).toHaveLength(1);
    const sender = vi.fn().mockResolvedValue({ state: "sent_via_api" });
    await mod.flushBillWhatsappQueue(sender);
    await mod.flushBillWhatsappQueue(sender);
    expect(sender).toHaveBeenCalledTimes(1);
  });
});
