import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { dateRangeForDateOnly, formatDateInTimeZone } from "../src/utils/dates.js";
import { toBaseQty } from "../src/utils/units.js";

const root = process.cwd();
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");

const envConfig = read("src/config/env.js");
assert.match(envConfig, /JWT_SECRET must be at least 32 characters in production/, "production JWT secret must be strong");
assert.match(envConfig, /DATABASE_URL must use PostgreSQL in production/, "production database must be PostgreSQL");
assert.match(envConfig, /OWNER_PIN_REQUIRED must stay true in production/, "production must not allow Owner PIN bypass");
assert.match(envConfig, /ALLOWED_ORIGINS must contain only real production origins in production/, "production CORS must reject localhost/wildcards");
assert.match(envConfig, /ALLOWED_ORIGINS must use HTTPS origins in production/, "production CORS origins must use HTTPS");
assert.match(envConfig, /METRICS_REQUIRE_TOKEN must be true in production/, "production metrics must require token");
assert.match(envConfig, /METRICS_TOKEN must be at least 24 characters in production/, "production metrics token must be strong");

const authRoutes = read("src/modules/auth/auth.routes.js");
assert.match(authRoutes, /router\.post\("\/staff"[\s\S]*?requireOwnerPin[\s\S]*?ctrl\.inviteStaff\)/, "staff invite must require Owner PIN");
assert.match(authRoutes, /router\.patch\("\/staff\/:id\/role"[\s\S]*?requireOwnerPin[\s\S]*?ctrl\.updateStaffRole\)/, "staff role changes must require Owner PIN");
assert.match(authRoutes, /router\.delete\("\/staff\/:id"[\s\S]*?requireOwnerPin[\s\S]*?ctrl\.removeStaff\)/, "staff removal must require Owner PIN");

const devicesRoutes = read("src/modules/devices/devices.routes.js");
for (const route of ["remove", "block", "unblock"]) {
  assert.match(devicesRoutes, new RegExp(`requireOwnerPin[\\s\\S]*?ctrl\\.${route}`), `device ${route} must require Owner PIN`);
}

const subscriptionRoutes = read("src/modules/subscription/subscription.routes.js");
for (const route of ["manualActivate", "changePlan", "cancel", "extendGrace"]) {
  assert.match(subscriptionRoutes, new RegExp(`requireOwnerPin[\\s\\S]*?ctrl\\.${route}`), `subscription ${route} must require Owner PIN`);
}

const providerRoutes = read("src/modules/payment-provider/paymentProvider.routes.js");
assert.match(providerRoutes, /\/events\/:id\/retry"[\s\S]*?requireOwnerPin[\s\S]*?ctrl\.retryEvent/, "payment provider event retry must require Owner PIN");
assert.match(providerRoutes, /\/manual\/activate"[\s\S]*?requireOwnerPin[\s\S]*?ctrl\.manualActivate/, "manual payment activation must require Owner PIN");

const jobsRoutes = read("src/modules/jobs/jobs.routes.js");
for (const route of ["retry", "discard"]) {
  assert.match(jobsRoutes, new RegExp(`requireOwnerPin[\\s\\S]*?ctrl\\.${route}`), `job ${route} must require Owner PIN`);
}
assert.doesNotMatch(jobsRoutes, /ctrl\.(?:pause|resume)/, "tenant owners must not pause or resume shared global queues");

const permissions = read("src/middleware/permissions.js");
assert.match(permissions, /OWNER_PIN_VERIFICATION_FAILED/, "failed Owner PIN attempts must be audited");
assert.match(permissions, /OWNER_PIN_LOCKED/, "repeated Owner PIN failures must trigger a stable lockout response");
assert.match(permissions, /auditLog\.count/, "Owner PIN lockout must be persisted across backend replicas");

const customersRoutes = read("src/modules/customers/customers.routes.js");
const customersService = read("src/modules/customers/customers.service.js");
const customersSchema = read("src/modules/customers/customers.schema.js");
assert.match(customersRoutes, /\/udhar-payment\/:ledgerId\/reverse"[\s\S]*?requireOwnerPin/, "udhar payment reversal route must require Owner PIN");
assert.match(customersService, /reversalOfLedgerId/, "udhar reversal must link to the original ledger entry");
assert.match(customersService, /UDHAR_PAYMENT_REVERSED/, "udhar reversal must be audit logged");
assert.match(customersSchema, /reverseUdharPaymentSchema/, "udhar reversal payload must be validated");

const syncRules = read("src/utils/syncRules.js");
const syncService = read("src/modules/sync/sync.service.js");
assert.match(syncRules, /REVERSE_UDHAR_PAYMENT/, "sync rules must support udhar reversal");
assert.match(syncRules, /UPDATE_PURCHASE_BILL/, "sync rules must support purchase bill updates");
assert.match(syncRules, /DELETE_PURCHASE_BILL/, "sync rules must support purchase bill delete/void");
assert.match(syncRules, /'purchaseHistoryId'/, "sync result promotion must expose purchase history ids");
assert.match(syncRules, /'stockLedgerId'/, "sync result promotion must expose stock ledger ids");
assert.match(syncRules, /'localMovementId'/, "sync result promotion must expose local movement ids");
assert.match(syncService, /applyReverseUdharPayment/, "sync push must apply udhar reversal");
assert.match(syncService, /applyUpdatePurchaseBill/, "sync push must apply purchase bill updates");
assert.match(syncService, /applyDeletePurchaseBill/, "sync push must apply purchase bill delete/void");
assert.match(syncService, /stockLedgerId: data\.stockLedgerId/, "stock purchase sync must return server stock ledger id");
assert.match(syncService, /localMovementId: payload\.movementId/, "stock purchase sync must preserve local movement id");
assert.match(syncService, /resolvePurchaseLocatorIds[\s\S]*SYNC_ENTITY_TYPES\.STOCK_LEDGER[\s\S]*localMovementId/, "purchase bill updates must resolve local stock movement ids through sync mappings");
assert.match(syncService, /ledgerEntries/, "sync id mapping must include ledger entries");
assert.match(syncService, /purchaseHistory/, "sync id mapping must include purchase history");
assert.match(syncService, /stockLedger/, "sync id mapping must include stock ledger");

const sqliteSchema = read("prisma/schema.prisma");
const pgSchema = read("prisma-postgres/schema.prisma");
for (const schema of [sqliteSchema, pgSchema]) {
  assert.match(schema, /reversedAt\s+DateTime\?/, "UdharLedger must store reversal timestamp");
  assert.match(schema, /reversalOfLedgerId\s+String\?/, "UdharLedger must link reversal to original ledger entry");
  assert.match(schema, /model StockLedger[\s\S]*purchasePaidAmount\s+Float\s+@default\(0\)/, "StockLedger must store supplier purchase paid amount");
  assert.match(schema, /model StockLedger[\s\S]*purchaseDueAmount\s+Float\s+@default\(0\)/, "StockLedger must store supplier purchase due amount");
  assert.match(schema, /model PurchaseHistory[\s\S]*purchasePaymentStatus\s+String\s+@default\("paid"\)/, "PurchaseHistory must store purchase payment status");
  assert.match(schema, /model PurchaseHistory[\s\S]*purchaseDueDate\s+DateTime\?/, "PurchaseHistory must store purchase due date");
}

const istRange = dateRangeForDateOnly("2026-06-07", "Asia/Kolkata");
assert.equal(istRange.start.toISOString(), "2026-06-06T18:30:00.000Z", "IST day should start at previous-day 18:30 UTC");
assert.equal(istRange.end.toISOString(), "2026-06-07T18:29:59.999Z", "IST day should end at same-day 18:29:59.999 UTC");
assert.equal(formatDateInTimeZone(new Date("2026-06-06T18:31:00.000Z"), "Asia/Kolkata"), "2026-06-07", "report day grouping must use shop timezone");

assert.equal(toBaseQty(2, "kg", "kg"), 2, "known base unit should convert");
assert.equal(toBaseQty(250, "g", "kg"), 0.25, "known gram unit should convert to kg base");
assert.throws(() => toBaseQty(1, "mystery-unit", "kg"), /Unsupported unit/, "unknown units must be rejected instead of silently counted as quantity 1");


const apiContract = read("contracts/api-contract.v1.json");
assert.match(apiContract, /\"path\": \"\/api\/customers\/:id\/udhar-payment\/:ledgerId\/reverse\"/, "API contract must document udhar payment reversal");

const reportsService = read("src/modules/reports/reports.service.js");
assert.match(reportsService, /oldUdharRecovered/, "reports must include old udhar recovery in cash\/UPI collection views");
assert.match(reportsService, /totalCashInHandPaise/, "payment mode report must expose total cash in hand");
assert.match(reportsService, /totalUpiReceivedPaise/, "payment mode report must expose total UPI received");
assert.match(reportsService, /reversedAt:\s*null/, "reports must exclude reversed udhar payments");
assert.match(reportsService, /purchaseCashPaid/, "payment summary must expose supplier cash paid");
assert.match(reportsService, /purchaseUpiPaid/, "payment summary must expose supplier UPI paid");
assert.match(reportsService, /purchaseDue/, "payment summary must expose supplier due amount");

const inventorySchema = read("src/modules/inventory/inventory.schema.js");
const inventoryService = read("src/modules/inventory/inventory.service.js");
assert.match(inventorySchema, /purchasePaymentStatus/, "purchase schema must accept frontend payment status");
assert.match(inventorySchema, /purchasePaidAmount/, "purchase schema must accept frontend paid amount");
assert.match(inventorySchema, /purchaseDueAmount/, "purchase schema must accept frontend due amount");
assert.match(inventoryService, /normalizePurchasePayment/, "purchase service must normalize purchase payment fields");
assert.match(inventoryService, /purchaseHistoryId/, "purchase response must expose purchase history id");
assert.match(inventoryService, /stockLedgerId/, "purchase response must expose stock ledger id");

console.log("Phase 48 sellable hardening examples passed");
