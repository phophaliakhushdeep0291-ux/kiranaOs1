-- GST mode per bill: inclusive (MRP prices, default) | exclusive | none
ALTER TABLE "Bill" ADD COLUMN "gstMode" TEXT NOT NULL DEFAULT 'inclusive';
