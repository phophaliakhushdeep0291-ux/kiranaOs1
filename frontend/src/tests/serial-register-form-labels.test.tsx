import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import type { ProductUnit } from "@/types/api";

/**
 * Every box on the serial register's forms says what it is to a screen reader.
 *
 * The captions were drawn beside each box but not tied to it. In "Already
 * sold" the bill number — the one field with neither a placeholder nor a
 * starting value — was announced as an unnamed text box, and the rest as
 * "Optional" or "0". "Add Units" had the same gap for its cost, warranty,
 * purchase-bill and paste boxes, and its catalogue search had only a
 * placeholder. A shop owner relying on a screen reader could not tell which
 * box took what.
 */

// The dialog renders into a portal, which has no document on the server; its
// contents are rendered in place so the fields can be read.
vi.mock("@/components/ui/dialog", () => {
  const Pass = ({ children }: { children?: ReactNode }) => <div>{children}</div>;
  return { Dialog: Pass, DialogContent: Pass, DialogHeader: Pass, DialogTitle: Pass, DialogDescription: Pass };
});
// One draft shape serves both forms: each reads only its own fields.
vi.mock("@/hooks/use-counter-draft", () => ({
  useCounterDraft: () => ({
    value: {
      unit: null, billNumber: "", soldOn: "2026-10-01", customerName: "", customerPhone: "", sellingPrice: "0",
      open: true, productId: "", productSearch: "", costPrice: "0", warrantyMonths: "12", purchaseBillId: "", bulk: "",
      units: [{ imei: "", imei2: "", serialNumber: "", condition: "new" }],
    },
    pending: false,
    recoveryRequired: false,
    storageFailed: false,
    update: () => {},
    discard: () => {},
  }),
}));
vi.mock("@/features/core/settings/i18n", () => ({ useAppLanguage: () => ({ t: (key: string) => key }) }));
vi.mock("@/features/core/products/queries", () => ({ useListProducts: () => ({ data: [], isLoading: false }) }));

const { RecordSaleDialog } = await import("@/features/verticals/electronics/units/pages/ProductUnitsPage");
const { ReceiveUnitsPanel } = await import("@/features/verticals/electronics/units/components/ReceiveUnitsPanel");

/**
 * Every form control in the markup, with how it is named: an `aria-label`, a
 * `<label for>` pointing at its id, or a `<label>` wrapped around it.
 */
function controls(markup: string) {
  const forIds = new Set([...markup.matchAll(/<label[^>]*\bfor="([^"]+)"/g)].map(([, id]) => id));
  const found: Array<{ tag: string; named: boolean }> = [];
  let insideLabel = 0;
  for (const [tag, closing, name] of markup.matchAll(/<(\/?)(label|input|textarea|select)\b[^>]*>/g)) {
    if (name === "label") {
      insideLabel += closing ? -1 : 1;
      continue;
    }
    if (closing) continue;
    const id = tag.match(/\bid="([^"]+)"/)?.[1];
    found.push({ tag, named: insideLabel > 0 || /\baria-label="[^"]+"/.test(tag) || Boolean(id && forIds.has(id)) });
  }
  return found;
}

describe("Already sold dialog", () => {
  const unit = { id: "u1", productName: "Redmi 13C", imei: "861234567890201", warrantyMonths: 12 } as ProductUnit;
  const markup = renderToStaticMarkup(<RecordSaleDialog unit={unit} saving={false} onClose={() => {}} onConfirm={() => {}} />);
  const labelFor = [...markup.matchAll(/<label[^>]*\bfor="([^"]+)"[^>]*>([^<]*)<\/label>/g)].map(([, id, text]) => ({ id, text }));
  const inputIds = [...markup.matchAll(/<input[^>]*\bid="([^"]+)"/g)].map(([, id]) => id);

  it("gives every field a label that points at it", () => {
    const fields = controls(markup);
    expect(fields).toHaveLength(5);
    expect(fields.filter((field) => !field.named)).toEqual([]);
    expect(labelFor.map((label) => label.id).sort()).toEqual([...inputIds].sort());
    // The ids are unique — two dialogs on a page must not point at each other's boxes.
    expect(new Set(inputIds).size).toBe(inputIds.length);
  });

  it("names the bill number box", () => {
    const bill = labelFor.find((label) => label.text === "workflow.electronics.sold.billNumber");
    expect(bill).toBeDefined();
    expect(inputIds).toContain(bill!.id);
  });
});

describe("Add Units panel", () => {
  const markup = renderToStaticMarkup(
    <ReceiveUnitsPanel open saving={false} width={500} onResizeStart={() => {}} onClose={() => {}} onSubmit={() => {}} />,
  );

  it("names every box, the catalogue search and each unit's fields included", () => {
    const fields = controls(markup);
    // Search, cost, warranty, purchase bill, the paste box, and one unit's
    // IMEI, second IMEI, serial and condition.
    expect(fields).toHaveLength(9);
    expect(fields.filter((field) => !field.named).map((field) => field.tag)).toEqual([]);
  });

  it("reads each caption as the name of the box under it, not the hint beside it", () => {
    expect(markup).toMatch(/<label[^>]*><span[^>]*>Cost each \(₹\)<\/span><input/);
    expect(markup).toMatch(/<label[^>]*><span[^>]*>Paste many at once<\/span><textarea/);
    expect(markup).toContain('aria-label="workflow.electronics.register.productSearch"');
  });
});
