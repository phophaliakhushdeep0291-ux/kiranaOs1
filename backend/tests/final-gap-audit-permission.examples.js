import assert from "node:assert/strict";
import fs from "node:fs";

const productRoutes = fs.readFileSync("src/modules/products/products.routes.js", "utf8");
const productService = fs.readFileSync("src/modules/products/products.service.js", "utf8");
const inventoryService = fs.readFileSync("src/modules/inventory/inventory.service.js", "utf8");
const permissions = fs.readFileSync("src/middleware/permissions.js", "utf8");
const syncService = fs.readFileSync("src/modules/sync/sync.service.js", "utf8");
const productionCheck = fs.readFileSync("scripts/production-check.js", "utf8");
const deployDoc = fs.readFileSync("DEPLOY.md", "utf8");
const packageJson = JSON.parse(fs.readFileSync("package.json", "utf8"));

assert.ok(
  productRoutes.includes('router.post("/:id/restore", requireOwnerPin, ctrl.restore);'),
  "product restore route must require owner role or owner PIN"
);

assert.match(
  syncService,
  /case SYNC_EVENT_TYPES\.RESTORE_PRODUCT:[\s\S]*assertOwnerPermission\(shopId, user, getEventOwnerPin\(event\)\)[\s\S]*return applyRestoreProduct/,
  "offline RESTORE_PRODUCT sync must assert owner permission before restore"
);

for (const action of [
  "PRODUCT_RESTORED",
  "PRODUCT_PERMANENTLY_DELETED",
  "PRODUCT_RECYCLE_BIN_EMPTIED",
]) {
  assert.ok(productService.includes(action), `${action} audit action must be logged from product service`);
}

assert.match(productService, /PRODUCT_RESTORED[\s\S]*?before:[\s\S]*?after:[\s\S]*?metadata:[\s\S]*?name:[\s\S]*?category:/, "product restore audit must include before/after and product metadata");
assert.match(productService, /PRODUCT_PERMANENTLY_DELETED[\s\S]*?before:[\s\S]*?metadata:[\s\S]*?hardDelete: true/, "permanent delete audit must include deleted-product and hard-delete metadata");
assert.match(productService, /PRODUCT_RECYCLE_BIN_EMPTIED[\s\S]*?metadata:[\s\S]*?deletedCount:[\s\S]*?blockedCount:/, "empty recycle bin audit must include deleted/blocked counts");
assert.match(productService, /return \{[\s\S]*category: deletedProduct\.category[\s\S]*deletedAt: deletedProduct\.deletedAt/, "permanent delete service must return deleted product metadata for audit");
assert.match(productService, /deleted\.push\(\{ id: product\.id, name: product\.name, category: product\.category/, "empty recycle bin result must preserve product metadata for audit");

for (const action of ["STOCK_CORRECTED", "STOCK_DAMAGED"]) {
  assert.ok(inventoryService.includes(action), `${action} audit action must be logged from inventory service`);
}
assert.match(inventoryService, /STOCK_CORRECTED[\s\S]*?before: \{ stockBaseQty: stockResult\.oldStock \}[\s\S]*?after: \{ stockBaseQty: stockResult\.newStock \}[\s\S]*?\}, tx\);/, "stock correction audit must include before/after stock in the active transaction");
assert.match(inventoryService, /STOCK_DAMAGED[\s\S]*?before: \{ stockBaseQty: stockResult\.oldStock \}[\s\S]*?after: \{ stockBaseQty: stockResult\.newStock \}[\s\S]*?damageLossValue[\s\S]*?\}, tx\);/, "stock damage audit must include loss and before/after stock in the active transaction");
assert.match(inventoryService, /productName: product\.name[\s\S]*oldStockBaseQty[\s\S]*newStockBaseQty/, "inventory service must return stock metadata for audit");

assert.ok(permissions.includes("OWNER_PIN_VERIFIED"), "successful owner PIN verification must be audited");
const pinCompareAt = permissions.indexOf("const ok = await bcrypt.compare(ownerPin, owner.pinHash);");
const pinFailureAt = permissions.indexOf("if (!ok)", pinCompareAt);
const pinVerifiedAt = permissions.indexOf("await logOwnerPinVerified(req);", pinFailureAt);
assert.ok(
  pinCompareAt >= 0 && pinFailureAt > pinCompareAt && pinVerifiedAt > pinFailureAt,
  "owner PIN audit must happen only after successful bcrypt compare and failure handling"
);
assert.match(
  permissions.slice(pinFailureAt, pinVerifiedAt),
  /logOwnerPinFailure[\s\S]*throwPinFailureOrLockout/,
  "wrong owner PIN must be recorded and rejected (or locked out) before success is audited"
);
const ownerPinAuditBlock = permissions.match(/async function logOwnerPinVerified\(req\) \{[\s\S]*?\n\}/)?.[0] ?? "";
assert.ok(
  ownerPinAuditBlock.includes("OWNER_PIN_VERIFIED") || ownerPinAuditBlock.includes("OWNER_PIN_SUCCESS_ACTION"),
  "owner PIN audit helper must use the verified-success audit action"
);
assert.ok(!ownerPinAuditBlock.includes("ownerPin"), "owner PIN audit metadata must not log the PIN value");

for (const action of [
  "PRODUCT_RESTORED",
  "PRODUCT_PERMANENTLY_DELETED",
  "PRODUCT_RECYCLE_BIN_EMPTIED",
  "STOCK_CORRECTED",
  "STOCK_DAMAGED",
  "OWNER_PIN_VERIFIED",
]) {
  assert.ok(productionCheck.includes(action), `production-check must detect missing ${action}`);
}
assert.ok(productionCheck.includes("Product restore route must require owner PIN"), "production-check must detect unprotected product restore route");
assert.ok(productionCheck.includes("RESTORE_PRODUCT sync must assert owner permission"), "production-check must detect unprotected RESTORE_PRODUCT sync");

for (const phrase of [
  "Helmet is installed and enabled",
  "Rate limiting",
  "Export routes require owner role or owner PIN",
  "Product delete, product restore",
  "Inventory correction and damage",
  "Sessions/refresh/logout",
  "Offline sync is improved",
  "database fields remain Float",
  "integer paise or Decimal",
  "monitoring",
  "backup",
  "npm ci",
  "npm run prisma:generate:postgres",
  "npm run prisma:deploy:postgres",
  "npm start",
]) {
  assert.ok(deployDoc.toLowerCase().includes(phrase.toLowerCase()), `DEPLOY.md must mention: ${phrase}`);
}
assert.ok(!deployDoc.includes("already installed, just wire in"), "DEPLOY.md must not contain outdated rate-limit wiring instructions");

assert.ok(
  packageJson.scripts["test:billing"].includes("tests/final-gap-audit-permission.examples.js"),
  "test:billing must include final gap permission/audit examples"
);

console.log("Final gap audit/permission examples passed");
