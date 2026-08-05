-- Stationery class book lists — the PostgreSQL twin of
-- prisma/migrations/20260805120000_stationery_book_lists.
--
-- "Class 6, DPS" -> eleven books, four notebooks and a geometry box. A list is a
-- recipe, not stock and not an order: readiness is computed against the live
-- catalogue every time it is read.
--
-- productId is intentionally not a foreign key: the list keeps naming a book the
-- shop has stopped stocking, and a null productId is how "we don't carry this"
-- is recorded.
--
-- @replay-safe: every object is created IF NOT EXISTS and every constraint is
-- guarded, so an interrupted deploy can replay this migration without error.

CREATE TABLE IF NOT EXISTS "BookList" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BookList_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BookListItem" (
    "id" TEXT NOT NULL,
    "listId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "qty" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BookListItem_pkey" PRIMARY KEY ("id")
);

-- One list per school, class and year — a second would be silently ignored by
-- whoever picked the first at the counter.
CREATE UNIQUE INDEX IF NOT EXISTS "BookList_shopId_schoolName_className_academicYear_name_key" ON "BookList"("shopId", "schoolName", "className", "academicYear", "name");
CREATE INDEX IF NOT EXISTS "BookList_shopId_deletedAt_idx" ON "BookList"("shopId", "deletedAt");
-- The counter lookup: "Class 6, DPS".
CREATE INDEX IF NOT EXISTS "BookList_shopId_schoolName_className_idx" ON "BookList"("shopId", "schoolName", "className");
CREATE INDEX IF NOT EXISTS "BookList_shopId_academicYear_idx" ON "BookList"("shopId", "academicYear");

CREATE INDEX IF NOT EXISTS "BookListItem_listId_idx" ON "BookListItem"("listId");
CREATE INDEX IF NOT EXISTS "BookListItem_productId_idx" ON "BookListItem"("productId");

-- Foreign keys are added separately and guarded: ADD CONSTRAINT has no
-- IF NOT EXISTS in PostgreSQL, so a replay would otherwise fail on duplicate_object.
DO $$
BEGIN
  ALTER TABLE "BookList"
    ADD CONSTRAINT "BookList_shopId_fkey"
    FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE "BookListItem"
    ADD CONSTRAINT "BookListItem_listId_fkey"
    FOREIGN KEY ("listId") REFERENCES "BookList"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;
