-- Add optional catalogue fields to Product: brand, mrp, reorderLevel, description, imageUrl, isLooseItem.
ALTER TABLE "Product" ADD COLUMN "brand" TEXT;
ALTER TABLE "Product" ADD COLUMN "mrp" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "reorderLevel" REAL NOT NULL DEFAULT 0;
ALTER TABLE "Product" ADD COLUMN "description" TEXT;
ALTER TABLE "Product" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Product" ADD COLUMN "isLooseItem" BOOLEAN NOT NULL DEFAULT false;
