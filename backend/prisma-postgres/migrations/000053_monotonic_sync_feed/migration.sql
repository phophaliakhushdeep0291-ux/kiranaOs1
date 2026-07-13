-- Seed a complete baseline so a device starting at sequence zero receives rows
-- created before this protocol was deployed.
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'product',"id",'insert','{}',CURRENT_TIMESTAMP FROM "Product";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'customer',"id",'insert','{}',CURRENT_TIMESTAMP FROM "Customer";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'bill',"id",'insert','{}',CURRENT_TIMESTAMP FROM "Bill";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'stock_ledger',"id",'insert','{}',CURRENT_TIMESTAMP FROM "StockLedger";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'udhar_ledger',"id",'insert','{}',CURRENT_TIMESTAMP FROM "UdharLedger";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'supplier',"id",'insert','{}',CURRENT_TIMESTAMP FROM "Supplier";
INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT "shopId",'purchase_history',"id",'insert','{}',CURRENT_TIMESTAMP FROM "PurchaseHistory";

CREATE OR REPLACE FUNCTION kirana_log_sync_root() RETURNS trigger AS $$
DECLARE row_data record;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt")
  VALUES (row_data."shopId", TG_ARGV[0], row_data."id", lower(TG_OP), '{}', CURRENT_TIMESTAMP);
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_product_change AFTER INSERT OR UPDATE OR DELETE ON "Product" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('product');
CREATE TRIGGER sync_customer_change AFTER INSERT OR UPDATE OR DELETE ON "Customer" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('customer');
CREATE TRIGGER sync_bill_change AFTER INSERT OR UPDATE OR DELETE ON "Bill" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('bill');
CREATE TRIGGER sync_stockledger_change AFTER INSERT OR UPDATE OR DELETE ON "StockLedger" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('stock_ledger');
CREATE TRIGGER sync_udharledger_change AFTER INSERT OR UPDATE OR DELETE ON "UdharLedger" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('udhar_ledger');
CREATE TRIGGER sync_supplier_change AFTER INSERT OR UPDATE OR DELETE ON "Supplier" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('supplier');
CREATE TRIGGER sync_purchasehistory_change AFTER INSERT OR UPDATE OR DELETE ON "PurchaseHistory" FOR EACH ROW EXECUTE FUNCTION kirana_log_sync_root('purchase_history');

CREATE OR REPLACE FUNCTION kirana_log_product_child() RETURNS trigger AS $$
DECLARE row_data record; parent_shop TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  SELECT "shopId" INTO parent_shop FROM "Product" WHERE "id" = row_data."productId";
  IF parent_shop IS NOT NULL THEN
    INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (parent_shop,'product',row_data."productId",'update','{}',CURRENT_TIMESTAMP);
  END IF;
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION kirana_log_bill_child() RETURNS trigger AS $$
DECLARE row_data record; parent_shop TEXT;
BEGIN
  IF TG_OP = 'DELETE' THEN row_data := OLD; ELSE row_data := NEW; END IF;
  SELECT "shopId" INTO parent_shop FROM "Bill" WHERE "id" = row_data."billId";
  IF parent_shop IS NOT NULL THEN
    INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (parent_shop,'bill',row_data."billId",'update','{}',CURRENT_TIMESTAMP);
  END IF;
  RETURN row_data;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER sync_product_selling_unit_change AFTER INSERT OR UPDATE OR DELETE ON "ProductSellingUnit" FOR EACH ROW EXECUTE FUNCTION kirana_log_product_child();
CREATE TRIGGER sync_bill_item_change AFTER INSERT OR UPDATE OR DELETE ON "BillItem" FOR EACH ROW EXECUTE FUNCTION kirana_log_bill_child();
CREATE TRIGGER sync_payment_change AFTER INSERT OR UPDATE OR DELETE ON "Payment" FOR EACH ROW EXECUTE FUNCTION kirana_log_bill_child();
