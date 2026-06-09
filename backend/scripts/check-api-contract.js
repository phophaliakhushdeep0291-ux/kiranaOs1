import fs from "fs";
import path from "path";

const root = process.cwd();
const contractPath = path.join(root, "contracts", "api-contract.v1.json");
const docsPath = path.join(root, "docs", "API_CONTRACT.md");
const appPath = path.join(root, "src", "app.js");

function fail(message) {
  console.error(`❌ API contract check failed: ${message}`);
  process.exit(1);
}

function ok(message) {
  console.log(`✅ ${message}`);
}

if (!fs.existsSync(contractPath)) fail("contracts/api-contract.v1.json missing");
if (!fs.existsSync(docsPath)) fail("docs/API_CONTRACT.md missing");

const contract = JSON.parse(fs.readFileSync(contractPath, "utf8"));
const docs = fs.readFileSync(docsPath, "utf8");
const app = fs.existsSync(appPath) ? fs.readFileSync(appPath, "utf8") : "";

if (contract.version !== "v1") fail("contract.version must be v1");
if (contract.basePath !== "/api") fail("contract.basePath must be /api");
if (!Array.isArray(contract.endpoints) || contract.endpoints.length < 60) fail("contract must document at least 60 endpoints");

const endpointKey = (endpoint) => `${endpoint.method.toUpperCase()} ${endpoint.path}`;
const keys = new Set();
for (const endpoint of contract.endpoints) {
  if (!endpoint.method || !endpoint.path) fail(`endpoint missing method/path: ${JSON.stringify(endpoint)}`);
  if (!/^GET|POST|PATCH|PUT|DELETE$/.test(endpoint.method)) fail(`unsupported method in ${endpointKey(endpoint)}`);
  if (endpoint.path.startsWith("/api/") && contract.basePath !== "/api") fail(`bad basePath for ${endpointKey(endpoint)}`);
  const key = endpointKey(endpoint);
  if (keys.has(key)) fail(`duplicate endpoint ${key}`);
  keys.add(key);
  if (endpoint.deviceRequired && !endpoint.authRequired) fail(`${key} requires device but does not require auth`);
  if (endpoint.ownerPinRequired && !endpoint.authRequired) fail(`${key} requires owner PIN but does not require auth`);
}

const requiredEndpoints = [
  "POST /api/auth/login",
  "POST /api/devices/activate",
  "GET /api/devices/license",
  "GET /api/subscription/current",
  "POST /api/subscription/checkout",
  "POST /api/subscription/verify-payment",
  "POST /api/payment-provider/razorpay/webhook",
  "GET /api/payment-provider/events",
  "POST /api/payment-provider/events/:id/retry",
  "GET /api/products",
  "POST /api/products",
  "POST /api/bills/confirm",
  "POST /api/customers/:id/udhar-payment",
  "POST /api/customers/:id/udhar-payment/:ledgerId/reverse",
  "POST /api/inventory/correction",
  "GET /api/sync/status",
  "POST /api/sync/retry",
  "POST /api/sync/resolve-conflict",
  "GET /api/sync/pull",
  "POST /api/sync/push",
  "GET /api/jobs/workers",
  "POST /api/reminders/send",
  "POST /api/ai/parse-command"
];
for (const key of requiredEndpoints) {
  if (!keys.has(key)) fail(`required endpoint not documented: ${key}`);
}

const deviceRequiredPrefixes = [
  "/api/shops",
  "/api/products",
  "/api/customers",
  "/api/bills",
  "/api/inventory",
  "/api/udhar",
  "/api/suppliers",
  "/api/reports",
  "/api/sync",
  "/api/jobs",
  "/api/reminders",
  "/api/ai"
];
for (const prefix of deviceRequiredPrefixes) {
  const matching = contract.endpoints.filter((endpoint) => endpoint.path.startsWith(prefix));
  if (!matching.length) fail(`no documented endpoints for ${prefix}`);
  const missing = matching.filter((endpoint) => !endpoint.deviceRequired);
  if (missing.length) fail(`${prefix} has endpoint(s) missing deviceRequired=true: ${missing.map(endpointKey).join(", ")}`);
}


const paymentProviderDevicePaths = [
  "/api/payment-provider/events",
  "/api/payment-provider/events/:id/retry",
  "/api/payment-provider/manual/activate",
];
for (const path of paymentProviderDevicePaths) {
  const endpoint = contract.endpoints.find((item) => item.path === path);
  if (!endpoint?.authRequired) fail(`${path} must require auth`);
  if (!endpoint?.deviceRequired) fail(`${path} must require active device`);
}

const webhook = contract.endpoints.find((endpoint) => endpoint.path === "/api/payment-provider/razorpay/webhook");
if (!webhook?.rawBodySignature) fail("Razorpay webhook must be marked rawBodySignature=true");
if (!app.includes('express.raw({ type: "application/json"') && !app.includes("express.raw({ type: 'application/json'")) {
  fail("app.js must keep Razorpay webhook raw body parser before JSON parser");
}

const pull = contract.endpoints.find((endpoint) => endpoint.path === "/api/sync/pull");
if (!pull?.responseMustInclude?.includes("sync.entityCursors")) fail("sync pull contract must require sync.entityCursors");

const verifyPayment = contract.endpoints.find((endpoint) => endpoint.path === "/api/subscription/verify-payment");
for (const requirement of ["signature", "orderId", "paymentId", "amount", "currency", "localTransaction"]) {
  if (!verifyPayment?.paymentVerification?.includes(requirement)) fail(`payment verification missing ${requirement}`);
}

for (const phrase of ["x-device-id", "Authorization", "entityCursors", "owner PIN", "shopId"]) {
  if (!docs.includes(phrase)) fail(`API contract docs must mention ${phrase}`);
}

ok(`API contract v1 covers ${contract.endpoints.length} endpoints`);
