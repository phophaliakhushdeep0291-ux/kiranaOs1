import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { cardTerminalReadiness, getCardTerminalProvider, simulatedTerminalProvider, TERMINAL_STATUSES } from "../src/modules/payment-provider/terminal.provider.js";
import { createPineLabsTerminalProvider } from "../src/modules/payment-provider/pineLabsTerminal.provider.js";
import { assertCardTerminalLocation, isAmbiguousTerminalStartError } from "../src/modules/payment-provider/cardTerminal.service.js";

/**
 * The card terminal seam. Pine Labs is contract-tested without credentials or
 * a physical device; the suite also proves the guards that stop the development
 * simulator from ever confirming real money.
 *
 * Each env scenario runs in its own process because config/env.js parses
 * process.env once at import.
 */

// A production deployment must not be able to boot a terminal that approves
// payments no bank ever saw. This is a startup failure, not a runtime warning.
const PRODUCTION_ENV = {
  NODE_ENV: "production",
  // The parent integration runner enables this test-only switch. Production
  // boot scenarios must explicitly reset it so the terminal guard is the
  // safety invariant being exercised here.
  ALLOW_MANUAL_SUBSCRIPTION_ACTIVATION: "false",
  JWT_SECRET: "test-jwt-secret-that-is-long-enough-1234567890",
  DATABASE_URL: "postgresql://u:p@localhost:5432/db",
  OWNER_PIN_REQUIRED: "true",
  LICENSE_SIGNING_SECRET: "test-license-secret-long-enough-1234567890",
  INTEGRATION_SIGNING_SECRET: "test-integration-secret-long-enough-12345",
  ALLOWED_ORIGINS: "https://pos.example.com",
  METRICS_ENABLED: "false",
};

function bootEnv(overrides) {
  return spawnSync(process.execPath, ["-e", "import('./src/config/env.js').then(() => console.log('BOOTED'))"], {
    encoding: "utf8",
    cwd: process.cwd(),
    env: { ...process.env, ...PRODUCTION_ENV, ...overrides },
    timeout: 30_000,
  });
}

const simulatedInProduction = bootEnv({ CARD_TERMINAL_PROVIDER: "simulated" });
assert.match(
  `${simulatedInProduction.stdout}${simulatedInProduction.stderr}`,
  /cannot run in production/,
  "a simulated card terminal must refuse to boot in production",
);
assert.doesNotMatch(`${simulatedInProduction.stdout}`, /BOOTED/, "the process must not continue past the guard");

const noTerminal = bootEnv({ CARD_TERMINAL_PROVIDER: "none" });
assert.match(`${noTerminal.stdout}`, /BOOTED/, "a counter with no terminal must still boot in production");

// A half-configured vendor fails at deploy time, not at the counter mid-sale.
const halfConfigured = bootEnv({ CARD_TERMINAL_PROVIDER: "pine_labs", CARD_TERMINAL_BASE_URL: "https://terminal.example.com" });
assert.match(
  `${halfConfigured.stdout}${halfConfigured.stderr}`,
  /CARD_TERMINAL_API_KEY.*required|required.*CARD_TERMINAL_API_KEY/,
  "a vendor terminal without credentials must not boot",
);

const wrongPineLabsOrigin = bootEnv({
  CARD_TERMINAL_PROVIDER: "pine_labs",
  CARD_TERMINAL_BASE_URL: "https://terminal.example.com",
  CARD_TERMINAL_API_KEY: "secret-token",
  CARD_TERMINAL_MERCHANT_ID: "merchant",
  CARD_TERMINAL_ID: "TERM-1",
  CARD_TERMINAL_STORE_ID: "STORE-1",
  CARD_TERMINAL_LOCATION_CODE: "MAIN",
});
assert.match(
  `${wrongPineLabsOrigin.stdout}${wrongPineLabsOrigin.stderr}`,
  /official Pine Labs production cloud origin/,
  "production must not send terminal credentials to a lookalike host",
);

const pineLabsProduction = bootEnv({
  CARD_TERMINAL_PROVIDER: "pine_labs",
  CARD_TERMINAL_BASE_URL: "https://www.plutuscloudservice.in:8201",
  CARD_TERMINAL_API_KEY: "secret-token",
  CARD_TERMINAL_MERCHANT_ID: "merchant",
  CARD_TERMINAL_ID: "TERM-1",
  CARD_TERMINAL_STORE_ID: "STORE-1",
  CARD_TERMINAL_LOCATION_CODE: "MAIN",
});
assert.match(`${pineLabsProduction.stdout}`, /BOOTED/, "a complete Pine Labs production configuration must boot");

const unavailableEzetapProduction = bootEnv({
  CARD_TERMINAL_PROVIDER: "ezetap",
  CARD_TERMINAL_BASE_URL: "https://terminal.example.com",
  CARD_TERMINAL_API_KEY: "secret-token",
  CARD_TERMINAL_MERCHANT_ID: "merchant",
  CARD_TERMINAL_ID: "TERM-1",
  CARD_TERMINAL_STORE_ID: "STORE-1",
  CARD_TERMINAL_LOCATION_CODE: "MAIN",
});
assert.match(
  `${unavailableEzetapProduction.stdout}${unavailableEzetapProduction.stderr}`,
  /ezetap cannot run in production/i,
  "an unavailable provider must fail at deployment, not at a cashier's first charge",
);
assert.doesNotMatch(unavailableEzetapProduction.stdout, /BOOTED/);

// ── The interface every vendor implementation must satisfy ───────────────────
for (const call of ["createCharge", "fetchCharge", "cancelCharge", "describe"]) {
  assert.equal(typeof simulatedTerminalProvider[call], "function", `a terminal provider must expose ${call}`);
}
assert.deepEqual(TERMINAL_STATUSES, ["pending", "approved", "declined", "cancelled", "failed"]);

simulatedTerminalProvider.__test.reset();

// A charge starts pending: money moves when the customer taps, not when we ask.
const charge = simulatedTerminalProvider.createCharge({ amountPaise: 125_00, reference: "intent_1", idempotencyKey: "intent_1" });
assert.equal(charge.status, "pending");
assert.ok(charge.chargeId, "a charge must carry a reference we can poll");
assert.equal(simulatedTerminalProvider.fetchCharge(charge.chargeId).status, "pending");

// Retrying the same request must not ask the customer to tap twice.
const retried = simulatedTerminalProvider.createCharge({ amountPaise: 125_00, reference: "intent_1", idempotencyKey: "intent_1" });
assert.equal(retried.chargeId, charge.chargeId, "an idempotent retry must reuse the in-flight charge");

// A different bill is a different charge.
const other = simulatedTerminalProvider.createCharge({ amountPaise: 125_00, reference: "intent_2", idempotencyKey: "intent_2" });
assert.notEqual(other.chargeId, charge.chargeId);

simulatedTerminalProvider.__test.settle(charge.chargeId, "approved");
const approved = simulatedTerminalProvider.fetchCharge(charge.chargeId);
assert.equal(approved.status, "approved");
assert.equal(approved.amountPaise, 125_00, "the acquirer's own amount must come back for cross-checking");
assert.ok(approved.paymentId, "an approval must carry a payment reference to store against the bill");

// Money that has already moved cannot be waved away at the counter.
assert.throws(() => simulatedTerminalProvider.cancelCharge(charge.chargeId), /cannot be cancelled/i);

// A pending charge can be abandoned, and a declined one reports why.
simulatedTerminalProvider.cancelCharge(other.chargeId);
assert.equal(simulatedTerminalProvider.fetchCharge(other.chargeId).status, "cancelled");

const declined = simulatedTerminalProvider.createCharge({ amountPaise: 500, reference: "intent_3", idempotencyKey: "intent_3" });
simulatedTerminalProvider.__test.settle(declined.chargeId, "declined", { failureReason: "Insufficient funds" });
assert.equal(simulatedTerminalProvider.fetchCharge(declined.chargeId).failureReason, "Insufficient funds");

assert.throws(() => simulatedTerminalProvider.fetchCharge("sim_missing"), /not found/i);

// ── Pine Labs documented cloud contract ─────────────────────────────────────
const pineCalls = [];
const pineResponses = [
  { ResponseCode: 0, ResponseMessage: "APPROVED", PlutusTransactionReferenceID: 501 },
  {
    ResponseCode: 0,
    ResponseMessage: "TXN APPROVED",
    PlutusTransactionReferenceID: 501,
    TransactionData: [
      { Tag: "PaymentMode", Value: "CARD" },
      { Tag: "AmountInPaisa", Value: "12500" },
      { Tag: "RRN", Value: "000792514130" },
      { Tag: "ApprovalCode", Value: "849035" },
      { Tag: "Card Type", Value: "VISA" },
    ],
  },
  { ResponseCode: 0, ResponseMessage: "APPROVED" },
];
const pineLabs = createPineLabsTerminalProvider({
  baseUrl: "https://www.plutuscloudserviceuat.in:8201",
  securityToken: "secret-token",
  merchantId: "1234",
  terminalId: "318462",
  storeId: "61607",
  locationCode: "MAIN",
  requestTimeoutMs: 1_000,
  fetchImpl: async (url, init) => {
    pineCalls.push({ url, body: JSON.parse(init.body) });
    return { ok: true, status: 200, json: async () => pineResponses.shift() };
  },
});

const pineCharge = await pineLabs.createCharge({ amountPaise: 12_500, reference: "intent-1", idempotencyKey: "intent-1" });
assert.deepEqual(pineCharge, { chargeId: "501", status: "pending" }, "an upload acknowledgement must remain pending");
assert.match(pineCalls[0].url, /UploadBilledTransaction$/);
assert.equal(pineCalls[0].body.Amount, 12_500, "Pine Labs receives integer paise");
assert.equal(pineCalls[0].body.TransactionNumber, "intent1", "the idempotency key is the stable vendor transaction number");
assert.equal(pineCalls[0].body.StoreId, "61607", "the charge must be pinned to the configured store");

const pineApproved = await pineLabs.fetchCharge("501");
assert.equal(pineApproved.status, "approved");
assert.equal(pineApproved.amountPaise, 12_500, "the provider amount must be returned for the service-level exact-amount check");
assert.equal(pineApproved.paymentId, "000792514130", "the acquirer reference must be persisted");
assert.equal(pineApproved.cardNetwork, "VISA");
assert.equal(pineApproved.authCode, "849035");
assert.match(pineCalls[1].url, /GetCloudBasedTxnStatus$/);

await pineLabs.cancelCharge("501", { amountPaise: 12_500 });
assert.match(pineCalls[2].url, /CancelTransaction$/);
assert.equal(pineCalls[2].body.Amount, 12_500, "cancellation must repeat the exact original amount");
await assert.rejects(() => pineLabs.cancelCharge("501"), /original paise amount is required/i);

const pendingPineLabs = createPineLabsTerminalProvider({
  baseUrl: "https://www.plutuscloudserviceuat.in:8201",
  securityToken: "token",
  merchantId: "1234",
  terminalId: "318462",
  storeId: "61607",
  locationCode: "MAIN",
  fetchImpl: async () => ({
    ok: true,
    status: 200,
    json: async () => ({ ResponseCode: 1, ResponseMessage: "INVALID PLUTUS TXN REF ID" }),
  }),
});
assert.equal((await pendingPineLabs.fetchCharge("new-ptrid")).status, "pending", "eventual-consistency misses must wait for the bounded local expiry");

const rejectedPineLabs = createPineLabsTerminalProvider({
  baseUrl: "https://www.plutuscloudserviceuat.in:8201",
  securityToken: "token",
  merchantId: "1234",
  terminalId: "318462",
  storeId: "61607",
  locationCode: "MAIN",
  fetchImpl: async () => ({ ok: true, status: 200, json: async () => ({ ResponseCode: 1, ResponseMessage: "INVALID SOURCE DEVICE" }) }),
});
await assert.rejects(
  () => rejectedPineLabs.createCharge({ amountPaise: 500, reference: "intent-2", idempotencyKey: "intent-2" }),
  (error) => error?.code === "CARD_TERMINAL_PROVIDER_REJECTED",
  "a rejected upload must fail without creating a payable local intent",
);

const timedOutPineLabs = createPineLabsTerminalProvider({
  baseUrl: "https://www.plutuscloudserviceuat.in:8201",
  securityToken: "token",
  merchantId: "1234",
  terminalId: "318462",
  storeId: "61607",
  locationCode: "MAIN",
  requestTimeoutMs: 5,
  fetchImpl: async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener("abort", () => {
      const error = new Error("aborted");
      error.name = "AbortError";
      reject(error);
    }, { once: true });
  }),
});
await assert.rejects(
  () => timedOutPineLabs.createCharge({ amountPaise: 500, reference: "intent-timeout", idempotencyKey: "intent-timeout" }),
  (error) => error?.code === "CARD_TERMINAL_PROVIDER_TIMEOUT" && isAmbiguousTerminalStartError(error),
  "a lost upload response must be classified as an unknown money outcome, not a definite failure",
);

const definiteHttpRejection = createPineLabsTerminalProvider({
  baseUrl: "https://www.plutuscloudserviceuat.in:8201",
  securityToken: "token",
  merchantId: "1234",
  terminalId: "318462",
  storeId: "61607",
  locationCode: "MAIN",
  fetchImpl: async () => ({ ok: false, status: 400 }),
});
await assert.rejects(
  () => definiteHttpRejection.createCharge({ amountPaise: 500, reference: "intent-bad", idempotencyKey: "intent-bad" }),
  (error) => error?.code === "CARD_TERMINAL_PROVIDER_REJECTED" && !isAmbiguousTerminalStartError(error),
  "a provider 4xx remains a definite rejection and does not block the branch for reconciliation",
);

assert.doesNotThrow(() => assertCardTerminalLocation({ code: "main" }, "MAIN"), "branch codes compare canonically");
assert.throws(
  () => assertCardTerminalLocation({ code: "DELHI" }, "MAIN"),
  (error) => error?.code === "CARD_TERMINAL_LOCATION_MISMATCH" && error?.statusCode === 409,
  "a terminal assigned to MAIN must never receive DELHI's bill",
);

// With no terminal configured, asking for one is a clear 503 rather than a
// crash halfway through a sale.
assert.equal(cardTerminalReadiness().provider, "none", "no terminal is configured by default");
assert.equal(cardTerminalReadiness().configured, false);
assert.throws(() => getCardTerminalProvider(), /No card terminal is configured/i);

// The remaining unimplemented vendor names exactly what has to be built, and a readiness
// probe reports it as unconfigured instead of throwing on every billing load.
const vendorProbe = spawnSync(process.execPath, ["-e", `
  const { getCardTerminalProvider, cardTerminalReadiness } = await import("./src/modules/payment-provider/terminal.provider.js");
  console.log(JSON.stringify(cardTerminalReadiness()));
  try { getCardTerminalProvider().createCharge({ amountPaise: 100 }); }
  catch (error) { console.log(error.code, "|", error.message); }
`.trim()], {
  encoding: "utf8",
  cwd: process.cwd(),
  env: {
    ...process.env,
    CARD_TERMINAL_PROVIDER: "ezetap",
    CARD_TERMINAL_BASE_URL: "https://terminal.example.com",
    CARD_TERMINAL_API_KEY: "key",
    CARD_TERMINAL_MERCHANT_ID: "merchant",
    CARD_TERMINAL_ID: "TERM-1",
    CARD_TERMINAL_STORE_ID: "STORE-1",
    CARD_TERMINAL_LOCATION_CODE: "MAIN",
  },
  timeout: 30_000,
});
const vendorOutput = `${vendorProbe.stdout}${vendorProbe.stderr}`;
assert.match(vendorOutput, /CARD_TERMINAL_PROVIDER_NOT_IMPLEMENTED/, "an unbuilt vendor must fail with a specific code");
assert.match(vendorOutput, /Ezetap/, "the error must name the vendor still to be implemented");
assert.match(vendorOutput, /terminal\.provider\.js/, "the error must point at where the implementation goes");
assert.match(vendorOutput, /"configured":false/, "an unbuilt vendor must read as unconfigured, not crash a readiness probe");

// ── Service guards ───────────────────────────────────────────────────────────
const service = fs.readFileSync("src/modules/payment-provider/cardTerminal.service.js", "utf8");
const routes = fs.readFileSync("src/modules/payment-provider/paymentProvider.routes.js", "utf8");
const terminal = fs.readFileSync("src/modules/payment-provider/terminal.provider.js", "utf8");
const schemas = fs.readFileSync("src/modules/payment-provider/paymentProvider.schemas.js", "utf8");

assert.match(service, /CARD_TERMINAL_AMOUNT_MISMATCH/, "a terminal settling a different amount must fail closed");
assert.match(service, /CARD_TERMINAL_LOCATION_MISMATCH/, "a globally configured terminal must refuse another branch's bill");
assert.match(service, /status: \{ in: OPEN_STATUSES \}, providerPaymentId: null/, "confirmation must be claimed atomically once");
assert.match(service, /confirmationSource: "terminal_provider_api"/, "confirmation provenance must be persisted");
assert.match(service, /RETAIL_PAYMENT_ALREADY_CONFIRMED/, "an approved card payment must not be cancellable");
assert.match(service, /checkoutMode: "terminal"/, "terminal charges must be distinguishable from QR and checkout intents");
assert.match(service, /tenderMode: "bank"/, "a card charge settles to the bank, never the cash drawer");
assert.match(service, /idempotencyKey: intent\.id/, "a retried charge must not double-present the card");
assert.match(service, /status: ambiguous \? "uncertain" : "failed"/, "a lost upload response must never be recorded as a definite failure");
assert.match(service, /status: "uncertain"/, "a branch must detect unresolved terminal money outcomes");
assert.match(service, /return terminalIntentResponse\(unresolved/, "a later cashier must be taken back to the unresolved charge instead of creating another one");
assert.match(service, /CARD_TERMINAL_RECONCILIATION_REQUIRED/, "unknown outcomes must not be cancellable like unpaid charges");
assert.match(service, /confirmationSource: "owner_provider_reconciliation"/, "manual charged resolution must retain its weaker provenance");
assert.match(service, /CARD_TERMINAL_UNCERTAIN_RECONCILED/, "every owner resolution must be audited");
assert.match(service, /CARD_TERMINAL_PAYMENT_REFERENCE_REUSED/, "one acquirer reference must not confirm two intents");
assert.match(schemas, /requestId: z\.string\(\)\.uuid\(\)\.optional\(\)/, "the client retry key must be a validated UUID");
assert.match(routes, /terminal\/charges\/:id\/status/, "a cashier must be able to poll the terminal");
assert.match(routes, /terminal\/charges\/:id\/cancel/, "a cashier must be able to abandon an unpaid charge");
assert.match(routes, /terminal\/charges\/:id\/reconcile.*requireOwnerPin/, "only an owner-PIN decision may reconcile unknown money");
assert.match(terminal, /CARD_TERMINAL_PROVIDER_NOT_IMPLEMENTED/, "an unbuilt vendor must fail loudly and specifically");

console.log("Card terminal seam examples passed");
