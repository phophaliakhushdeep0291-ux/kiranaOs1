import assert from "assert";
import fs from "fs";

function read(path) {
  return fs.readFileSync(new URL(path, import.meta.url), "utf8");
}

const sqliteSchema = read("../prisma/schema.prisma");
const postgresSchema = read("../prisma-postgres/schema.prisma");

for (const [name, schema] of [["sqlite", sqliteSchema], ["postgres", postgresSchema]]) {
  assert.ok(schema.includes("model CustomerOrder"), `${name} schema must define CustomerOrder`);
  assert.ok(schema.includes("customerName"), `${name} CustomerOrder stores customer name`);
  assert.ok(schema.includes("customerMobile"), `${name} CustomerOrder stores customer mobile`);
  assert.ok(schema.includes("customerAddress"), `${name} CustomerOrder stores delivery address`);
  assert.ok(schema.includes("itemsJson"), `${name} CustomerOrder stores ordered items snapshot`);
  assert.ok(schema.includes("estimatedTotal"), `${name} CustomerOrder stores server-priced total`);
  assert.ok(schema.includes("status"), `${name} CustomerOrder stores owner workflow status`);
  assert.ok(schema.includes("idempotencyKey"), `${name} CustomerOrder stores public submit idempotency`);
  assert.ok(schema.includes("@@unique([shopId, idempotencyKey])"), `${name} CustomerOrder idempotency must be shop scoped`);
  assert.ok(schema.includes("customerOrders"), `${name} Shop relation must include customerOrders`);
}

const sqliteMigration = read("../prisma/migrations/20260708120000_add_customer_orders/migration.sql");
const postgresMigration = read("../prisma-postgres/migrations/000028_add_customer_orders/migration.sql");
for (const [name, migration] of [["sqlite", sqliteMigration], ["postgres", postgresMigration]]) {
  assert.ok(/CREATE TABLE.*CustomerOrder/s.test(migration), `${name} migration must create CustomerOrder`);
  assert.ok(migration.includes("customerMobile"), `${name} migration must persist customer mobile`);
  assert.ok(migration.includes("itemsJson"), `${name} migration must persist item snapshot`);
}

const sqliteIdempotencyMigration = read("../prisma/migrations/20260709010000_customer_order_idempotency/migration.sql");
const postgresIdempotencyMigration = read("../prisma-postgres/migrations/000029_customer_order_idempotency/migration.sql");
for (const [name, migration] of [["sqlite", sqliteIdempotencyMigration], ["postgres", postgresIdempotencyMigration]]) {
  assert.ok(migration.includes('ADD COLUMN "idempotencyKey"'), `${name} migration must add idempotencyKey without rebuilding order data`);
  assert.ok(migration.includes('"CustomerOrder_shopId_idempotencyKey_key"'), `${name} migration must enforce shop-scoped idempotency`);
}

const publicRoutes = read("../src/modules/public/public.routes.js");
assert.ok(
  publicRoutes.includes('router.post("/shops/:shopId/orders"'),
  "public QR page must expose a customer order submit endpoint",
);

const publicService = read("../src/modules/public/public.service.js");
assert.ok(
  publicService.includes("isCustomerOrderingEnabled(shop.settingsJson)"),
  "order submission must respect the shop customer-ordering opt-in",
);
assert.ok(
  publicService.includes("listProducts(shopId)") && publicService.includes("new Map(products.map"),
  "order submission must re-price from the shop catalog instead of trusting client prices",
);
assert.ok(
  publicService.includes("db.customerOrder.create"),
  "order submission must write a CustomerOrder row",
);
assert.ok(
  publicRoutes.includes('router.post("/shops/:shopId/orders"') && read("../src/modules/public/public.controller.js").includes("Idempotency-Key"),
  "public order submission must accept an Idempotency-Key header",
);
assert.ok(
  publicService.includes("cleanOrderIdempotencyKey") && publicService.includes("P2002") && publicService.includes("duplicate"),
  "order submission must be retry-safe and return the existing order on duplicate idempotency",
);
assert.ok(
  publicService.includes("const itemCount = lines.length"),
  "CustomerOrder.itemCount must count lines, not decimal quantities",
);

const app = read("../src/app.js");
assert.ok(app.includes('app.use("/api/orders", orderRoutes)'), "owner orders API must be mounted");

const ownerRoutes = read("../src/modules/orders/orders.routes.js");
assert.ok(ownerRoutes.includes("requireAuth"), "owner orders API must require auth");
assert.ok(ownerRoutes.includes("requireShop"), "owner orders API must require a shop context");
assert.ok(ownerRoutes.includes('router.get("/", ctrl.list)'), "owner must be able to list received orders");
assert.ok(ownerRoutes.includes('router.patch("/:id", ctrl.updateStatus)'), "owner must be able to update order status");

console.log("customer-orders.examples.js OK");
