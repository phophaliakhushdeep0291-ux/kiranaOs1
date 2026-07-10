-- Bank is a first-class tender since the bank-payment-mode feature; the live daily
-- closing already reports bankReceivedPaise but locked/persisted snapshots dropped it.
ALTER TABLE "DailyClosingSnapshot" ADD COLUMN "bankReceivedPaise" INTEGER NOT NULL DEFAULT 0;
