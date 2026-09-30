import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductUnit } from "@/types/api";

/**
 * Every box in "Already sold" says what it is to a screen reader.
 *
 * The labels were drawn above each box but not tied to it, so the bill number —
 * the one field with neither a placeholder nor a starting value — was announced
 * as an unnamed text box, and the rest as "Optional" or "0". A shop owner
 * relying on a screen reader could not tell which box took the bill number.
 */

// The dialog renders into a portal, which has no document on the server; its
// contents are rendered in place so the fields can be read.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass };
});
vi.mock("@/hooks/use-counter-draft", () => ({
  useCounterDraft: () => ({
    value: { unit: null, billNumber: "", soldOn: "2026-10-01", customerName: "", customerPhone: "", sellingPrice: "0" },
    pending: false,
    update: () => {},
    discard: () => {},
  }),
}));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: string) => key }) }));

const { RecordSaleDialog } = await import("@/features/verticals/electronics/units/pages/ProductUnitsPage");

const unit = { id: "u1", productName: "Redmi 13C", imei: "861234567890201", warrantyMonths: 12 } as ProductUnit;

describe("Already sold dialog", () => {
  const markup = renderToStaticMarkup(<RecordSaleDialog unit={unit} saving={false} onClose={() => {}} onConfirm={() => {}} />);
  const labelFor = [...markup.matchAll(/<label[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/label>/g)].map(([, id, text]) => ({ id, text }));
  const inputIds = [...markup.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map(([, id]) => id);
  const inputCount = (markup.match(/<input\b/g) ?? []).length;

  it("gives every field a label that points at it", () => {
    expect(inputCount).toBe(5);
    expect(labelFor).toHaveLength(inputCount);
    expect(labelFor.map((label) => label.id).sort()).toEqual([...inputIds].sort());
    // The ids are unique — two dialogs on a page must not point at each other's boxes.
    expect(new Set(inputIds).size).toBe(inputIds.length);
  });

  it("names the bill number box", () => {
    const bill = labelFor.find((label) => label.text === "workflow.electronics.sold.billNumber");
    expect(bill).toBeDefined();
    expect(markup).toMatch(new RegExp(`<input[^>]*id="${bill!.id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
});
