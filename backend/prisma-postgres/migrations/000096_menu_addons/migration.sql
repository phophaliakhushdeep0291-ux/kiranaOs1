-- Menu add-ons — the PostgreSQL twin of
-- prisma/migrations/20260808120000_menu_addons. See the SQLite original for the
-- full rationale.
--
-- In short: an add-on group is defined once per shop and attached to as many
-- dishes as serve it, so a price rise is one edit rather than forty. A group
-- carries the RULE as well as the list (minSelect/maxSelect), which is what stops
-- an order arriving for a burger with no bun or with four.
--
-- An option priced at zero is a real value: "no onion" is an instruction the cook
-- needs and the guest is not charged for.
--
-- BillItemAddon snapshots every descriptive field so a reprinted receipt reads
-- what was sold, not what the option is called today; optionId is nullable and
-- cleared on delete so retiring an option cannot orphan a finalised bill.
--
-- @replay-safe: every table, index and constraint is guarded, so an interrupted
-- deploy can replay this without error.

CREATE TABLE IF NOT EXISTS "MenuAddonGroup" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- 0 = optional, 1 or more = the guest must choose that many.
    "minSelect" INTEGER NOT NULL DEFAULT 0,
    -- 0 = no ceiling.
    "maxSelect" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "deletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuAddonGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "MenuAddonOption" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    -- Zero is a real price here. See the money note above.
    "priceDelta" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priceDeltaPaise" BIGINT,
    -- The stock item this consumes, when it consumes one. Null = an instruction.
    "linkedProductId" TEXT,
    "linkedQtyBase" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "MenuAddonOption_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "ProductAddonGroup" (
    "id" TEXT NOT NULL,
    "shopId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "ProductAddonGroup_pkey" PRIMARY KEY ("id")
);

CREATE TABLE IF NOT EXISTS "BillItemAddon" (
    "id" TEXT NOT NULL,
    "billItemId" TEXT NOT NULL,
    -- Nullable, cleared on delete: retiring an option must not orphan a bill.
    "optionId" TEXT,
    "groupName" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "price" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pricePaise" BIGINT,
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BillItemAddon_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "MenuAddonGroup_shopId_name_key" ON "MenuAddonGroup"("shopId", "name");
CREATE INDEX IF NOT EXISTS "MenuAddonGroup_shopId_isActive_sortOrder_idx" ON "MenuAddonGroup"("shopId", "isActive", "sortOrder");
CREATE UNIQUE INDEX IF NOT EXISTS "MenuAddonOption_shopId_groupId_name_key" ON "MenuAddonOption"("shopId", "groupId", "name");
CREATE INDEX IF NOT EXISTS "MenuAddonOption_shopId_groupId_isActive_idx" ON "MenuAddonOption"("shopId", "groupId", "isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "ProductAddonGroup_productId_groupId_key" ON "ProductAddonGroup"("productId", "groupId");
CREATE INDEX IF NOT EXISTS "ProductAddonGroup_shopId_productId_idx" ON "ProductAddonGroup"("shopId", "productId");
CREATE INDEX IF NOT EXISTS "BillItemAddon_billItemId_idx" ON "BillItemAddon"("billItemId");
CREATE INDEX IF NOT EXISTS "BillItemAddon_optionId_idx" ON "BillItemAddon"("optionId");

-- ADD CONSTRAINT has no IF NOT EXISTS, so each foreign key is added inside a
-- block that swallows only the "already there" error.
DO $$ BEGIN
  ALTER TABLE "MenuAddonGroup" ADD CONSTRAINT "MenuAddonGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MenuAddonOption" ADD CONSTRAINT "MenuAddonOption_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MenuAddonOption" ADD CONSTRAINT "MenuAddonOption_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuAddonGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductAddonGroup" ADD CONSTRAINT "ProductAddonGroup_shopId_fkey" FOREIGN KEY ("shopId") REFERENCES "Shop"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductAddonGroup" ADD CONSTRAINT "ProductAddonGroup_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProductAddonGroup" ADD CONSTRAINT "ProductAddonGroup_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "MenuAddonGroup"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BillItemAddon" ADD CONSTRAINT "BillItemAddon_billItemId_fkey" FOREIGN KEY ("billItemId") REFERENCES "BillItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BillItemAddon" ADD CONSTRAINT "BillItemAddon_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "MenuAddonOption"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
