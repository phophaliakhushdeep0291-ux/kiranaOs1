-- GST mode per bill: inclusive (MRP prices, default) | exclusive | none
ALTER TABLE "Bill" ADD COLUMN IF NOT EXISTS "gstMode" TEXT NOT NULL DEFAULT 'inclusive';
