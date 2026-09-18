import { describe, expect, it } from "vitest";
import { billNumberLabel, billNumberShort, isUnsyncedBillNumber, localBillReference } from "@/features/core/billing/bill-number";
import { billingEn } from "@/features/core/settings/translations/billing";
import { billingHi } from "@/features/core/settings/translations/billing.hi";

/**
 * Driving a fresh shop end to end, the very first sale reported itself as
 * "पिछला बिल: PENDING-CFF518". The bill was safe and the number did become
 * KOS-2026-000001 once it synced — but an internal token is what the shopkeeper
 * was asked to read as their own invoice number, at the exact moment they are
 * deciding whether the till can be trusted.
 */

// The real dictionary substitution, so a key that stops interpolating fails here.
const t = ((key: string, vars?: Record<string, unknown>) => {
  const template = (billingEn as Record<string, string>)[key] ?? key;
  return template.replace(/\{(\w+)\}/g, (_, name) => String(vars?.[name] ?? `{${name}}`));
}) as never;

describe("isUnsyncedBillNumber", () => {
  it("recognises the device-minted pakka and estimate numbers", () => {
    expect(isUnsyncedBillNumber("PENDING-CFF518")).toBe(true);
    expect(isUnsyncedBillNumber("EST-2026-LOCAL-CFF518")).toBe(true);
  });

  it("leaves a server number alone", () => {
    expect(isUnsyncedBillNumber("KOS-2026-000001")).toBe(false);
    expect(isUnsyncedBillNumber("EST-2026-000004")).toBe(false);
  });

  it("treats absent numbers as nothing to flag", () => {
    expect(isUnsyncedBillNumber(null)).toBe(false);
    expect(isUnsyncedBillNumber(undefined)).toBe(false);
    expect(isUnsyncedBillNumber("")).toBe(false);
  });
});

describe("localBillReference", () => {
  it("keeps the suffix, which is the only handle on the bill before it syncs", () => {
    expect(localBillReference("PENDING-CFF518")).toBe("CFF518");
    expect(localBillReference("EST-2026-LOCAL-CFF518")).toBe("CFF518");
  });

  it("returns null once the server has numbered the bill", () => {
    expect(localBillReference("KOS-2026-000001")).toBeNull();
  });
});

describe("billNumberLabel", () => {
  it("never shows the internal word to a shopkeeper", () => {
    const label = billNumberLabel("PENDING-CFF518", t);
    expect(label).not.toMatch(/PENDING/i);
    expect(label).toContain("CFF518");
  });

  it("prints a server-assigned number exactly as issued", () => {
    expect(billNumberLabel("KOS-2026-000001", t)).toBe("KOS-2026-000001");
  });

  it("renders nothing for a bill with no number rather than the word undefined", () => {
    expect(billNumberLabel(null, t)).toBe("");
  });

  it("says in Hindi too that the number is not final, since Hindi is the default", () => {
    expect(billingHi["billing.billNumber.pending"]).not.toBe(billingEn["billing.billNumber.pending"]);
    expect(billingHi["billing.billNumber.pending"]).toContain("{reference}");
  });
});

describe("billNumberShort", () => {
  it("drops the internal word where the surrounding copy already explains the wait", () => {
    expect(billNumberShort("PENDING-CFF518")).toBe("#CFF518");
    expect(billNumberShort("EST-2026-LOCAL-CFF518")).toBe("#CFF518");
  });

  it("passes a server number through untouched", () => {
    expect(billNumberShort("KOS-2026-000001")).toBe("KOS-2026-000001");
  });

  it("renders nothing rather than the word undefined", () => {
    expect(billNumberShort(undefined)).toBe("");
  });
});
