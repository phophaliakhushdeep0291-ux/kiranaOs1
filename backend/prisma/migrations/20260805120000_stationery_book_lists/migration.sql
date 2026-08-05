-- Stationery: class book lists.
--
-- A book shop's whole year turns on one document. The school publishes the Class
-- 6 list, a parent walks in and says "Class 6, DPS", and the counter assembles
-- eleven books, four notebooks and a geometry box from a sheet taped to the
-- wall. The shop finds out what it is short of when a parent is already standing
-- there, because nothing in the app can hold that sheet.
--
-- A list is a recipe, not stock and not an order: readiness is computed against
-- the live catalogue every time it is read.
--
-- productId is intentionally not a foreign key: the list has to keep naming a
-- book the shop has stopped stocking, and a null productId is exactly how
-- "we don't carry this" is recorded.

CREATE TABLE "BookList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "schoolName" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "academicYear" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT '',
    "notes" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "BookList_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- One list per school, class and year — a second would be silently ignored by
-- whoever picked the first at the counter.
CREATE UNIQUE INDEX "BookList_shopId_schoolName_className_academicYear_name_key" ON "BookList"("shopId", "schoolName", "className", "academicYear", "name");
CREATE INDEX "BookList_shopId_deletedAt_idx" ON "BookList"("shopId", "deletedAt");
-- The counter lookup: "Class 6, DPS".
CREATE INDEX "BookList_shopId_schoolName_className_idx" ON "BookList"("shopId", "schoolName", "className");
CREATE INDEX "BookList_shopId_academicYear_idx" ON "BookList"("shopId", "academicYear");

CREATE TABLE "BookListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "listId" TEXT NOT NULL,
    "productId" TEXT,
    "name" TEXT NOT NULL,
    "qty" REAL NOT NULL DEFAULT 1,
    "unit" TEXT NOT NULL DEFAULT 'piece',
    "isOptional" BOOLEAN NOT NULL DEFAULT false,
    "notes" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "BookListItem_listId_fkey" FOREIGN KEY ("listId") REFERENCES "BookList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "BookListItem_listId_idx" ON "BookListItem"("listId");
CREATE INDEX "BookListItem_productId_idx" ON "BookListItem"("productId");
