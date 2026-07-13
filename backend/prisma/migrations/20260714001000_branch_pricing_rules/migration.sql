ALTER TABLE "PricingRule" ADD COLUMN "locationId" TEXT REFERENCES "StoreLocation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "PricingRule_shopId_locationId_status_priority_idx" ON "PricingRule"("shopId", "locationId", "status", "priority");
