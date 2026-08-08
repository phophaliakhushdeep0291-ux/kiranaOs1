-- One barcode, one product, enforced by the database — the PostgreSQL twin of
-- prisma/migrations/20260807170000_product_barcode_unique.
--
-- Capture-on-first-scan lets the catalog learn barcodes by being used: an unknown
-- code opens a sheet at the till, the cashier picks the item, and the code binds
-- to it. That moves the write path from an owner editing a form to a cashier with
-- a queue, so the guard cannot live in the UI. A code pointing at two products
-- bills whichever row the query happened to return first. That is silent, and it
-- is money.
--
-- NULL is not a value in a unique index, so the products that legitimately carry
-- no barcode do not collide with each other. The starter catalog ships all 560
-- rows with a NULL barcode for exactly this reason — a real EAN-13 for a specific
-- SKU cannot be invented, and a wrong one bills the wrong item.
--
-- Soft-deleted products KEEP their barcode reserved, deliberately. A product in
-- the recycle bin can be restored, and releasing its code would let that restore
-- create a true duplicate. products.service.js turns the constraint error into a
-- message naming the owning product and saying it is in the recycle bin.
--
-- BEFORE DEPLOYING: run `node scripts/check-barcode-uniqueness.js` against the
-- target database. This statement FAILS if two live products already share a
-- code, and it deliberately does not repair that itself — nulling a barcode on
-- production trade data is not a decision a migration should make silently.
--
-- @replay-safe: the index is created IF NOT EXISTS, so an interrupted deploy can
-- replay this without error.

CREATE UNIQUE INDEX IF NOT EXISTS "Product_shopId_barcode_key"
  ON "Product" ("shopId", "barcode");
