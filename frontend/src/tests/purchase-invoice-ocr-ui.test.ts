import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

describe("purchase invoice OCR review boundary", () => {
  const page = fs.readFileSync(path.resolve("src/features/purchases/pages/PurchaseBillsPage.tsx"), "utf8");
  const api = fs.readFileSync(path.resolve("src/features/purchases/invoice-ocr-api.ts"), "utf8");

  it("uploads a multipart image into a review-only draft", () => {
    expect(api).toContain('form.append("invoice", file, file.name)');
    expect(api).toContain('"/ai/extract-purchase-invoice"');
    expect(page).toContain("review-only draft");
    expect(page).toContain("verified fields — nothing posted");
    expect(page).toContain('accept="image/png,image/jpeg,image/webp"');
  });

  it("does not mutate purchase fields until explicit apply", () => {
    const extraction = page.slice(page.indexOf("async function readInvoice"), page.indexOf("function applyOcrDraft"));
    expect(extraction).toContain("setOcrDraft(draft)");
    expect(extraction).not.toContain("setLines(");
    expect(extraction).not.toContain("setPurchaseNo(");
  });

  it("keeps unsafe and unmatched values blank", () => {
    expect(page).toContain('line.catalogMatch === "exact" ? line.productId ?? "" : ""');
    expect(page).toContain("line.prefillAllowed && line.quantity != null");
    expect(page).toContain("line.prefillAllowed && line.unitCost != null");
    expect(page).toContain('ocrDraft.supplierMatch === "exact"');
    expect(page).not.toContain('setSupplierId("new")');
  });
});
