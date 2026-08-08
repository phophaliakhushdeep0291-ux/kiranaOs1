-- Menu add-ons: "extra cheese", "no onion", "choose your bread".
--
-- A group is defined ONCE per shop and attached to as many dishes as serve it.
-- Per-dish add-on lists mean editing the price of extra cheese in forty places;
-- here the paneer tikka and the paneer roll share one group and a price rise is
-- one edit.
--
-- What a group carries is the RULE, not only the list. minSelect and maxSelect
-- are what stop the kitchen receiving an order for a burger with no bun, or with
-- four of them: a compulsory choice is minSelect 1, and a ceiling is maxSelect.
--
-- Money note: an option's price may legitimately be zero. "No onion" and "less
-- spicy" are instructions the cook needs and the guest is not charged for, so a
-- zero here is a real value, not a missing one.
--
-- BillItemAddon copies every descriptive field rather than joining, for the same
-- reason a bill item copies the product name: a receipt reprinted next year must
-- read what was sold at the price it was sold for, not what the option is called
-- and costs today. optionId is nullable and cleared on delete so retiring an
-- option can never orphan a finalised bill.

CREATE TABLE "MenuAddonGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- 0 = optional, 1 or more = the guest must choose that many.
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    -- 0 = no ceiling.
    "maxSelect" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" DATETIME,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuAddonGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MenuAddonGroup_shopId_name_key" ON "MenuAddonGroup"("shopId", "name");
CREATE INDEX "MenuAddonGroup_shopId_isActive_sortOrder_idx" ON "MenuAddonGroup"("shopId", "isActive", "sortOrder");

CREATE TABLE "MenuAddonOption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Zero is a real price here. See the money note above.
    "priceDelta" REAL NOT NULL DEFAULT 0,
    "priceDeltaPaise" BIGINT,
    -- The stock item this consumes, when it consumes one. Null = an instruction.
    "linkedProductId" TEXT,
    "linkedQtyBase" REAL NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "MenuAddonOption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "MenuAddonOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuAddonGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "MenuAddonOption_shopId_groupId_name_key" ON "MenuAddonOption"("shopId", "groupId", "name");
CREATE INDEX "MenuAddonOption_shopId_groupId_isActive_idx" ON "MenuAddonOption"("shopId", "groupId", "isActive");

CREATE TABLE "ProductAddonGroup" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductAddonGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop" ("id") ON DELETE RESTRICT ON UPDATE CASCADE,
    CONSTRAINT "ProductAddonGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProductAddonGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuAddonGroup" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ProductAddonGroup_productId_groupId_key" ON "ProductAddonGroup"("productId", "groupId");
CREATE INDEX "ProductAddonGroup_shopId_productId_idx" ON "ProductAddonGroup"("shopId", "productId");

CREATE TABLE "BillItemAddon" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "billItemId" TEXT NOT NULL,
    -- Nullable, cleared on delete: retiring an option must not orphan a bill.
    "optionId" TEXT,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" REAL NOT NULL DEFAULT 0,
    "pricePaise" BIGINT,
    "quantity" REAL NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillItemAddon_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BillItemAddon_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "MenuAddonOption" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "BillItemAddon_billItemId_idx" ON "BillItemAddon"("billItemId");
CREATE INDEX "BillItemAddon_optionId_idx" ON "BillItemAddon"("optionId");
