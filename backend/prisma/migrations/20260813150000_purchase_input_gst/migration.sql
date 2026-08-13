-- Input GST on purchases.
--
-- A purchase voucher could carry no tax at all, because nothing captured any:
-- PurchaseReceipt held only the invoice total and Supplier had no GSTIN. So the
-- books showed the whole supplier invoice as goods value, and the shop's
-- accountant had to re-key every purchase to claim input tax credit — the exact
-- work exporting to Tally was supposed to remove.
--
-- The tax is stored as the tax, not the taxable value, so the goods value stays
-- a residual (invoice total − tax) and can never disagree with the invoice.
-- Existing receipts default to 0, which reads as "no tax recorded" and posts
-- exactly as they do today.
ALTER TABLE "Supplier" ADD COLUMN "gstin" TEXT;

ALTER TABLE "PurchaseReceipt" ADD COLUMN "supplierInvoiceTax" REAL NOT NULL DEFAULT 0;
ALTER TABLE "PurchaseReceipt" ADD COLUMN "supplierInvoiceTaxPaise" BIGINT;
