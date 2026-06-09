import assert from "node:assert/strict";
import fs from "node:fs";
import { buildSyncResult, SYNC_EVENT_TYPES } from "../src/utils/syncRules.js";

const billService = fs.readFileSync("src/modules/bills/bills.service.js", "utf8");
const billSchema = fs.readFileSync("src/modules/bills/bills.schema.js", "utf8");
const syncService = fs.readFileSync("src/modules/sync/sync.service.js", "utf8");

assert.match(billSchema, /creditAmount:\s*moneyAmount\(\)\.default\(0\)\.optional\(\)/, "CREATE_BILL schema must accept creditAmount separately from payments");
assert.match(billSchema, /At least one real payment or credit amount required/, "Full udhar bills with zero tender payments must be accepted");

assert.match(billService, /tenderPayments\s*=\s*rawBillPayments\.filter\(\(p\)\s*=>\s*p\.mode\s*!==\s*"credit"\)/, "Credit must be filtered out of backend payment rows");
assert.match(billService, /requestedCreditAmount/, "Backend must calculate udhar from creditAmount\/legacy credit exactly once");
assert.match(billService, /paymentRows\s*=\s*billPayments\.map/, "Payment table rows must come only from real tender payments");
assert.match(billService, /udharLedgerEntry\s*=\s*await tx\.udharLedger\.create/, "Udhar bill must create one ledger entry inside the bill transaction");
assert.match(billService, /udharAmount:\s*\{ increment:\s*creditAmount \}/, "Customer udhar balance must be incremented atomically with bill creation");
assert.match(billService, /payments:\s*bill\.payments\.filter\(\(payment\)\s*=>\s*payment\.mode\s*!==\s*"credit"\)/, "Backend response must not return fake credit as a payment row");

assert.match(syncService, /findExistingCreateBillResultByIdempotency/, "CREATE_BILL sync retries must dedupe by idempotency/client bill keys");
assert.match(syncService, /buildCreateBillSyncPayload/, "CREATE_BILL sync must return a normalized reconciliation payload");
assert.match(syncService, /serverBillId:\s*bill\.id/, "CREATE_BILL sync response must expose serverBillId");
assert.match(syncService, /udharLedgerEntry/, "CREATE_BILL sync response must include udhar ledger entry for reconciliation");
assert.match(syncService, /stockLedgerEntries/, "CREATE_BILL sync response must include stock ledger entries for reconciliation");

const response = buildSyncResult({
  eventId: "evt_udhar_1",
  type: SYNC_EVENT_TYPES.CREATE_BILL,
  status: "synced",
  success: true,
  result: {
    entity: "bill",
    action: "CREATE_BILL",
    billId: "bill_server_1",
    serverBillId: "bill_server_1",
    localBillId: "bill_local_1",
    clientBillId: "bill_local_1",
    idempotencyKey: "create-bill:test",
    bill: { id: "bill_server_1", grandTotal: 450, paidAmount: 0, creditAmount: 450 },
    billItems: [],
    customer: { id: "customer_1", udharAmount: 450 },
    udharLedgerEntry: { id: "ledger_1", amount: 450, type: "debit" },
    stockLedgerEntries: [],
  },
});

assert.equal(response.serverBillId, "bill_server_1");
assert.equal(response.localBillId, "bill_local_1");
assert.equal(response.bill.creditAmount, 450);
assert.equal(response.customer.udharAmount, 450);
assert.equal(response.udharLedgerEntry.amount, 450);

console.log("Phase 47 udhar atomic sync examples passed");
