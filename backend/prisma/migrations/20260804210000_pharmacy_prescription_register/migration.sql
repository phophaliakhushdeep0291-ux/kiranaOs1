-- Pharmacy prescription register.
--
-- Schedule H/H1/X medicines may not be sold without a recorded prescription,
-- and the register is what a drug inspector asks to see: prescriber, patient,
-- what was dispensed, and when. Nothing in the shared catalogue can answer that,
-- and no other trade in the app needs it.
--
-- billId/productId are intentionally not foreign keys: the register entry is the
-- legal record and must outlive a cancelled bill or a purged medicine.

CREATE TABLE "Prescription" (
    "id" TEXT NOT NULL PRIMARY KEY,
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
    "prescribedOn" DATETIME NOT NULL,
    "dispensedAt" DATETIME,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "billId" TEXT,
    "billNumber" TEXT,
    "refillsAllowed" INTEGER NOT NULL DEFAULT 0,
    "refillsUsed" INTEGER NOT NULL DEFAULT 0,
    "imageUrl" TEXT,
    "notes" TEXT,
    "createdByUserId" TEXT,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Prescription_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "Prescription_shopId_registerNumber_key" ON "Prescription"("shopId", "registerNumber");
CREATE INDEX "Prescription_shopId_deletedAt_idx" ON "Prescription"("shopId", "deletedAt");
-- The register as an inspector reads it: by date, newest first.
CREATE INDEX "Prescription_shopId_prescribedOn_idx" ON "Prescription"("shopId", "prescribedOn");
CREATE INDEX "Prescription_shopId_status_prescribedOn_idx" ON "Prescription"("shopId", "status", "prescribedOn");
CREATE INDEX "Prescription_shopId_scheduleType_prescribedOn_idx" ON "Prescription"("shopId", "scheduleType", "prescribedOn");
CREATE INDEX "Prescription_shopId_patientPhone_idx" ON "Prescription"("shopId", "patientPhone");
CREATE INDEX "Prescription_shopId_billId_idx" ON "Prescription"("shopId", "billId");

CREATE TABLE "PrescriptionItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "prescriptionId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "strength" TEXT,
    "dosage" TEXT,
    "qty" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'strip',
    "batchNumber" TEXT,
    "substitutedFor" TEXT,
    CONSTRAINT "PrescriptionItem_prescriptionId_fkey" FOREIGN KEY ("prescriptionId") REFERENCES "Prescription" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "PrescriptionItem_prescriptionId_idx" ON "PrescriptionItem"("prescriptionId");
CREATE INDEX "PrescriptionItem_productId_idx" ON "PrescriptionItem"("productId");
