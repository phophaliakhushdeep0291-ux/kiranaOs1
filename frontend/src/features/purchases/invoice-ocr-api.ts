import { apiRequest } from "@/lib/api/http";

export interface PurchaseInvoiceDraftLine {
  description: string; barcode: string | null; quantity: number | null; unit: string | null;
  unitCost: number | null; lineTotal: number | null; confidence: number;
  productId: string | null; productName: string | null; catalogMatch: "exact" | "ambiguous" | "unmatched";
  arithmeticStatus: "consistent" | "inconsistent" | "insufficient"; calculatedLineTotal: number | null;
  prefillAllowed: boolean; reviewIssues: string[];
}
export interface InvoiceAmountCheck {
  status: "consistent" | "inconsistent" | "insufficient"; actual: number | null; expected: number | null; issue?: string | null;
}
export interface PurchaseInvoiceDraft {
  reviewOnly: true; requiresReview: true; posted: false; sourceBytes: number;
  supplierName: string | null; supplierGstin: string | null; supplierId: string | null;
  supplierMatch: "exact" | "ambiguous" | "unmatched"; invoiceNumber: string | null; invoiceDate: string | null;
  subtotal: number | null; taxTotal: number | null; grandTotal: number | null;
  lines: PurchaseInvoiceDraftLine[]; warnings: string[];
  headerChecks: { invoiceDateValid: boolean; supplierExact: boolean };
  mathChecks: { linesToSubtotal: InvoiceAmountCheck; subtotalTaxToGrandTotal: InvoiceAmountCheck };
}

export async function extractPurchaseInvoice(file: File) {
  const form = new FormData();
  form.append("invoice", file, file.name);
  return apiRequest<{ draft: PurchaseInvoiceDraft }>("/ai/extract-purchase-invoice", {
    method: "POST", body: form, timeoutMs: 60_000,
  });
}
