import assert from "node:assert/strict";
import { Prisma } from "../src/db.js";
import { CREDENTIAL_FIELDS_ALWAYS_PRESERVED, PRESERVED_SHOP_MODELS, RESTORABLE_CHILD_MODELS, RESTORABLE_SHOP_MODELS } from "../src/modules/backups/backup-policy.js";

const tenantModels = Prisma.dmmf.datamodel.models.filter((model) => model.fields.some((field) => field.kind === "scalar" && field.name === "shopId")).map((model) => model.name).sort();
const preserved = new Set(PRESERVED_SHOP_MODELS);
const restored = new Set(RESTORABLE_SHOP_MODELS);
assert.deepEqual([...preserved].filter((name) => restored.has(name)), [], "A model cannot be both preserved and restored");
assert.deepEqual([...new Set([...preserved, ...restored])].sort(), tenantModels, "Every shop-scoped Prisma model needs an explicit backup policy");

for (const modelName of Object.keys(RESTORABLE_CHILD_MODELS)) {
  assert.ok(Prisma.dmmf.datamodel.models.some((model) => model.name === modelName), `Unknown child model ${modelName}`);
}
for (const modelName of ["User", "AuthToken", "Session", "IntegrationApiKey", "WebhookEndpoint", "Device", "DeviceLicense", "Subscription", "PaymentTransaction", "BackupArtifact", "ShopMaintenanceLock"]) {
  assert.ok(preserved.has(modelName), `${modelName} must remain installation-controlled`);
}
for (const field of CREDENTIAL_FIELDS_ALWAYS_PRESERVED) assert.ok(/hash|token|secret/i.test(field));
console.log(`Backup model policy examples passed (${tenantModels.length} tenant models classified)`);
