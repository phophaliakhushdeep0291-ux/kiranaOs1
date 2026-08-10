-- @replay-safe: the foreign key is dropped conditionally before re-adding it,
-- and every trigger function uses CREATE OR REPLACE.
ALTER TABLE "ChangeLog" DROP CONSTRAINT IF EXISTS "ChangeLog_shopId_fkey";
ALTER TABLE "ChangeLog"
  ADD CONSTRAINT "ChangeLog_shopId_fkey"
  FOREIGN KEY ("shopId") REFERENCES "Shop"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION kirana_log_sync_root() RETURNS trigger AS $$
DECLARE row_data record;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  SELECT row_data."shopId", TG_ARGV[0], row_data."id", lower(TG_OP), '{}', CURRENT_TIMESTAMP
  WHERE NOT EXISTS (
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM "Shop" WHERE "id" = row_data."shopId")
  );
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kirana_log_product_child() RETURNS trigger AS $$
DECLARE row_data record; parent_shop TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  SELECT p."shopId" INTO parent_shop FROM "Product" p JOIN "Shop" s ON s."id" = p."shopId" WHERE p."id" = row_data."productId";
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  SELECT parent_shop,'product',row_data."productId",'update','{}',CURRENT_TIMESTAMP
  WHERE NOT EXISTS (SELECT 1 WHERE parent_shop IS NULL);
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kirana_log_bill_child() RETURNS trigger AS $$
DECLARE row_data record; parent_shop TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  SELECT b."shopId" INTO parent_shop FROM "Bill" b JOIN "Shop" s ON s."id" = b."shopId" WHERE b."id" = row_data."billId";
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  SELECT parent_shop,'bill',row_data."billId",'update','{}',CURRENT_TIMESTAMP
  WHERE NOT EXISTS (SELECT 1 WHERE parent_shop IS NULL);
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;
