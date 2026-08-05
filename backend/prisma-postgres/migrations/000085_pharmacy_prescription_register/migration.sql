-- Pharmacy prescription register — the PostgreSQL twin of
-- prisma/migrations/20260804210000_pharmacy_prescription_register.
--
-- Schedule H/H1/X medicines may not be sold without a recorded prescription,
-- and this is the register a drug inspector asks to see: prescriber, patient,
-- what was dispensed, and when.
--
-- billId/productId are intentionally not foreign keys: the register entry is the
-- legal record and must outlive a cancelled bill or a purged medicine.
--
-- @replay-safe: every object is created IF NOT EXISTS and every constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "Prescription" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "registerNumber" TEXT NOT NULL,
    "doctorName" TEXT NOT NULL,
    "doctorRegNo" TEXT,
    "doctorClinic" TEXT,
    "customerId" TEXT,
    "patientName" TEXT NOT NULL,
    "patientPhone" TEXT NOT NULL DEFAULT '',
    "patientAge" TEXT,
    "patientGender" TEXT,
    "patientAddress" TEXT NOT NULL DEFAULT '',
    "scheduleType" TEXT NOT NULL DEFAULT 'h',
    "prescribedOn" TIMESTAMP(3) NOT NULL,
    "dispensedAt" TIMESTAMP(3),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "billId" TEXT,
    "billNumber" TEXT,
    "refillsAllowed" INTEGER NOT NULL DEFAULT 0,
    "refillsUsed" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Prescription_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "PrescriptionItem" (
    "id" TEXT NOT NULL,
    "prescriptionId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "dosage" TEXT,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'strip',
    "batchNumber" TEXT,
    "substitutedFor" TEXT,
    CONSTRAINT "PrescriptionItem_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Prescription_shopId_registerNumber_key" ON "Prescription"("shopId", "registerNumber");
CREATE INDEX IF NOT EXISTS "Prescription_shopId_deletedAt_idx" ON "Prescription"("shopId", "deletedAt");
-- The register as an inspector reads it: by date, newest first.
CREATE INDEX IF NOT EXISTS "Prescription_shopId_prescribedOn_idx" ON "Prescription"("shopId", "prescribedOn");
CREATE INDEX IF NOT EXISTS "Prescription_shopId_status_prescribedOn_idx" ON "Prescription"("shopId", "status", "prescribedOn");
CREATE INDEX IF NOT EXISTS "Prescription_shopId_scheduleType_prescribedOn_idx" ON "Prescription"("shopId", "scheduleType", "prescribedOn");
CREATE INDEX IF NOT EXISTS "Prescription_shopId_patientPhone_idx" ON "Prescription"("shopId", "patientPhone");
CREATE INDEX IF NOT EXISTS "Prescription_shopId_billId_idx" ON "Prescription"("shopId", "billId");

CREATE INDEX IF NOT EXISTS "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");
CREATE INDEX IF NOT EXISTS "PrescriptionItem_productId_idx" ON "PrescriptionItem"("productId");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "Prescription"
    ADD CONSTRAINT "Prescription_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "PrescriptionItem"
    ADD CONSTRAINT "PrescriptionItem_prescriptionId_fkey"
    FOREIGN KEY ("prescriptionId") REFERENCES "Prescription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
