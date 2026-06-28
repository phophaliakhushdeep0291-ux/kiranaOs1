-- Keep final sale bill numbers and estimate bill numbers on independent sequences.
-- Existing production data is preserved; shops start estimate numbering from 0.
ALTER TABLE "BillCounter" ADD COLUMN "estimateLastNumber" INTEGER NOT NULL DEFAULT 0;
