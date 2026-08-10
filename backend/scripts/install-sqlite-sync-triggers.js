import db from "../src/db.js";

const directEntities = [
  ["Product", "product"],
  ["Customer", "customer"],
  ["Bill", "bill"],
  ["StockLedger", "stock_ledger"],
  ["UdharLedger", "udhar_ledger"],
  ["Supplier", "supplier"],
  ["PurchaseHistory", "purchase_history"],
  ["Expense", "expense"],
];

const statements = [];
for (const [table, entityType] of directEntities) {
  const slug = table.toLowerCase();
  statements.push(
    `CREATE TRIGGER IF NOT EXISTS "sync_${slug}_insert" AFTER INSERT ON "${table}" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'${entityType}',NEW."id",'insert','{}',CURRENT_TIMESTAMP); END`,
    `CREATE TRIGGER IF NOT EXISTS "sync_${slug}_update" AFTER UPDATE ON "${table}" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") VALUES (NEW."shopId",'${entityType}',NEW."id",'update','{}',CURRENT_TIMESTAMP); END`,
    `CREATE TRIGGER IF NOT EXISTS "sync_${slug}_delete" AFTER DELETE ON "${table}" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT OLD."shopId",'${entityType}',OLD."id",'delete','{}',CURRENT_TIMESTAMP WHERE EXISTS (SELECT 1 FROM "Shop" WHERE "id"=OLD."shopId"); END`,
  );
}

for (const operation of ["INSERT", "UPDATE", "DELETE"]) {
  const ref = operation === "DELETE" ? "OLD" : "NEW";
  const suffix = operation.toLowerCase();
  statements.push(
    `CREATE TRIGGER IF NOT EXISTS "sync_product_selling_unit_${suffix}" AFTER ${operation} ON "ProductSellingUnit" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT p."shopId",'product',${ref}."productId",'update','{}',CURRENT_TIMESTAMP FROM "Product" p JOIN "Shop" s ON s."id"=p."shopId" WHERE p."id"=${ref}."productId"; END`,
    `CREATE TRIGGER IF NOT EXISTS "sync_bill_item_${suffix}" AFTER ${operation} ON "BillItem" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT b."shopId",'bill',${ref}."billId",'update','{}',CURRENT_TIMESTAMP FROM "Bill" b JOIN "Shop" s ON s."id"=b."shopId" WHERE b."id"=${ref}."billId"; END`,
    `CREATE TRIGGER IF NOT EXISTS "sync_payment_${suffix}" AFTER ${operation} ON "Payment" BEGIN INSERT INTO "ChangeLog" ("shopId","entityType","entityId","operation","payloadJson","createdAt") SELECT b."shopId",'bill',${ref}."billId",'update','{}',CURRENT_TIMESTAMP FROM "Bill" b JOIN "Shop" s ON s."id"=b."shopId" WHERE b."id"=${ref}."billId"; END`,
  );
}

try {
  for (const statement of statements) await db.$executeRawUnsafe(statement);
  console.log(`Installed ${statements.length} SQLite monotonic-sync triggers.`);
} finally {
  await db.$disconnect();
}
