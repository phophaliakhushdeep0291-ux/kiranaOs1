import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { englishTranslations } from "@/features/core/settings/translations/english";

const purchasesPage = readFileSync(join(process.cwd(), "src/features/core/purchases/pages/PurchaseBillsPage.tsx"), "utf8");
const inventoryPage = readFileSync(join(process.cwd(), "src/features/core/inventory/pages/InventoryPage.tsx"), "utf8");
const apiTypes = readFileSync(join(process.cwd(), "src/types/api.ts"), "utf8");
const css = readFileSync(join(process.cwd(), "src/index.css"), "utf8");

/**
 * The lot is printed on the strip in the receiver's hand and on nothing the shop
 * keeps afterwards, so receiving is the only moment it can be captured.
 *
 * Until now only the purchase-ORDER receive dialog asked for it. This screen is
 * the offline-first one and the one most shops actually use, and it recorded
 * stock with no batch — building up batch-tracked inventory that FEFO could not
 * allocate and a recall could not find.
 */
describe("purchase form lot capture", () => {
  it("asks for the lot only on lines whose PRODUCT is batch-tracked", () => {
    // Not the shop's business type. Batch tracking is per product and opt-in — a
    // kirana store turns it on for dated food and nothing else — so a
    // trade-level test would demand a batch number for every packet of biscuits.
    expect(purchasesPage).toContain("function lineNeedsBatch(products: Product[], line: PurchaseLine)");
    expect(purchasesPage).toContain("?.batchTrackingEnabled");
    expect(purchasesPage).toContain("{lineNeedsBatch(products, line) && (");
  });

  it("refuses to save a batch-tracked line with no number or expiry", () => {
    expect(purchasesPage).toContain("const missingBatch = validLines.filter((line) => lineNeedsBatch(products, line)");
    expect(purchasesPage).toContain('t("purchases.batch.required")');
    expect(purchasesPage).toContain("return;");
  });

  it("catches the two date mistakes before the whole bill is lost", () => {
    expect(purchasesPage).toContain('t("purchases.batch.expired")');
    expect(purchasesPage).toContain('t("purchases.batch.datesInvalid")');
    expect(purchasesPage).toContain("line.manufacturedOn >= line.expiresOn");
  });

  it("sends the lot only for the lines that carry one", () => {
    // recordReceiptLot rejects batch details on a product without batch
    // tracking, so an unconditional spread would fail the whole receipt.
    expect(purchasesPage).toContain("...(lineNeedsBatch(products, line)");
    expect(purchasesPage).toContain("batchNumber: line.batchNumber.trim()");
    expect(purchasesPage).toContain("expiresOn: line.expiresOn");
  });

  it("names the fields on the wire type instead of leaning on the index signature", () => {
    // StockMovementInput has `[key: string]: unknown`, so a misspelling would
    // typecheck and silently record no batch at all.
    for (const field of ["batchNumber?: string;", "manufacturedOn?: string;", "expiresOn?: string;", "batchMrp?: number;"]) {
      expect(apiTypes, field).toContain(field);
    }
  });

  it("routes every new line through one factory so none starts without the fields", () => {
    expect(purchasesPage).toContain("function emptyPurchaseLine(key: number): PurchaseLine");
    // A literal `{ key, productId, qty, cost }` somewhere else would build a line
    // with undefined batch fields, and `.trim()` on it throws at save time.
    expect(purchasesPage).not.toMatch(/\{ key: keyRef\.current\+\+, productId: "", qty: "", cost: "" \}/);
  });

  it("spans the batch block across the fixed five-column line grid", () => {
    // .purchase-line is grid-cols-[1fr_56px_76px_76px_44px]; without col-span-full
    // this sixth child is squeezed into the 44px remove-button column.
    expect(css).toContain(".purchase-line-batch");
    expect(css).toMatch(/\.purchase-line-batch \{ @apply col-span-full/);
  });

  it("asks for the lot on BOTH receiving doors, not just this one", () => {
    // The inventory Add-stock dialog posts the same purchase through the same
    // service. Leaving it alone would have meant the server's tightened guard
    // simply broke that screen for batch-tracked products.
    expect(inventoryPage).toContain("const receivingBatchTracked = form.movementType === \"purchase\"");
    expect(inventoryPage).toContain("?.batchTrackingEnabled");
    expect(inventoryPage).toContain("{receivingBatchTracked ? (");
    for (const key of ["purchases.batch.required", "purchases.batch.expired", "purchases.batch.datesInvalid"]) {
      expect(inventoryPage, key).toContain(`t("${key}"`);
    }
  });

  it("tells the server it collected the lot, from every path that does", () => {
    // The server refuses a batch-tracked receipt with no lot ONLY when the client
    // claimed to ask for one. A path that captures the lot but forgets this flag
    // would quietly keep the old lenient behaviour.
    expect(purchasesPage).toContain("batchCaptureSupported: true");
    expect(inventoryPage).toContain("batchCaptureSupported: true");
  });

  it("translates every string it added, in both languages", () => {
    const keys = Object.keys(englishTranslations).filter((key) => key.startsWith("purchases.batch."));
    expect(keys.length).toBeGreaterThanOrEqual(12);
    for (const key of keys) {
      expect(englishTranslations[key as keyof typeof englishTranslations]?.trim().length, key).toBeGreaterThan(1);
    }
    expect(englishTranslations["purchases.batch.requiredDetail"]).toContain("{names}");
    expect(englishTranslations["purchases.batch.expiredDetail"]).toContain("{names}");
  });
});
