import assert from "node:assert/strict";
import fs from "node:fs";
import { spawnSync } from "node:child_process";
import { cardTerminalReadiness, getCardTerminalProvider, simulatedTerminalProvider, TERMINAL_STATUSES } from "../src/modules/payment-provider/terminal.provider.js";

/**
 * The card terminal seam. No vendor SDK, credentials or physical device exist
 * yet, so what is proven here is the contract every vendor plugs into and the
 * guards that stop the development simulator from ever confirming real money.
 *
 * Each env scenario runs in its own process because config/env.js parses
 * process.env once at import.
 */

// A production deployment must not be able to boot a terminal that approves
// payments no bank ever saw. This is a startup failure, not a runtime warning.
const PRODUCTION_ENV = {
  NODE_ENV: "production",
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

// With no terminal configured, asking for one is a clear 503 rather than a
// crash halfway through a sale.
assert.equal(cardTerminalReadiness().provider, "none", "no terminal is configured by default");
assert.equal(cardTerminalReadiness().configured, false);
assert.throws(() => getCardTerminalProvider(), /No card terminal is configured/i);

// An unimplemented vendor names exactly what has to be built, and a readiness
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
    CARD_TERMINAL_PROVIDER: "pine_labs",
    CARD_TERMINAL_BASE_URL: "https://terminal.example.com",
    CARD_TERMINAL_API_KEY: "key",
    CARD_TERMINAL_MERCHANT_ID: "merchant",
    CARD_TERMINAL_ID: "TERM-1",
  },
  timeout: 30_000,
});
const vendorOutput = `${vendorProbe.stdout}${vendorProbe.stderr}`;
assert.match(vendorOutput, /CARD_TERMINAL_PROVIDER_NOT_IMPLEMENTED/, "an unbuilt vendor must fail with a specific code");
assert.match(vendorOutput, /Pine Labs/, "the error must name the vendor still to be implemented");
assert.match(vendorOutput, /terminal\.provider\.js/, "the error must point at where the implementation goes");
assert.match(vendorOutput, /"configured":false/, "an unbuilt vendor must read as unconfigured, not crash a readiness probe");

// ── Service guards ───────────────────────────────────────────────────────────
const service = fs.readFileSync("src/modules/payment-provider/cardTerminal.service.js", "utf8");
const routes = fs.readFileSync("src/modules/payment-provider/paymentProvider.routes.js", "utf8");
const terminal = fs.readFileSync("src/modules/payment-provider/terminal.provider.js", "utf8");

assert.match(service, /CARD_TERMINAL_AMOUNT_MISMATCH/, "a terminal settling a different amount must fail closed");
assert.match(service, /status: \{ in: OPEN_STATUSES \}, providerPaymentId: null/, "confirmation must be claimed atomically once");
assert.match(service, /confirmationSource: "terminal_provider_api"/, "confirmation provenance must be persisted");
assert.match(service, /RETAIL_PAYMENT_ALREADY_CONFIRMED/, "an approved card payment must not be cancellable");
assert.match(service, /checkoutMode: "terminal"/, "terminal charges must be distinguishable from QR and checkout intents");
assert.match(service, /tenderMode: "bank"/, "a card charge settles to the bank, never the cash drawer");
assert.match(service, /idempotencyKey: intent\.id/, "a retried charge must not double-present the card");
assert.match(routes, /terminal\/charges\/:id\/status/, "a cashier must be able to poll the terminal");
assert.match(routes, /terminal\/charges\/:id\/cancel/, "a cashier must be able to abandon an unpaid charge");
assert.match(terminal, /CARD_TERMINAL_PROVIDER_NOT_IMPLEMENTED/, "an unbuilt vendor must fail loudly and specifically");

console.log("Card terminal seam examples passed");
