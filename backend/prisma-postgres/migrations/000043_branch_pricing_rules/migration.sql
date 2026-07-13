ALTER TABLE "PricingRule" ADD COLUMN "locationId" TEXT;
CREATE INDEX "PricingRule_shopId_locationId_status_priority_idx" ON "PricingRule"("shopId", "locationId", "status", "priority");
ALTER TABLE "PricingRule" ADD CONSTRAINT "PricingRule_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
