-- Persist per-shop preference settings (printer, taxes, notifications, security) as JSON.
ALTER TABLE "Shop" ADD COLUMN IF NOT EXISTS "settingsJson" TEXT NOT NULL DEFAULT '{}';
