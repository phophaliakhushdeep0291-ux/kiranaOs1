ALTER TABLE "PurchaseOrder" ADD COLUMN "vendorReference" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "paymentTerms" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "deliveryAddress" TEXT;
ALTER TABLE "PurchaseOrder" ADD COLUMN "termsAndConditions" TEXT;

CREATE INDEX "PurchaseOrder_shopId_supplierId_vendorReference_idx"
ON "PurchaseOrder"("shopId", "supplierId", "vendorReference");
