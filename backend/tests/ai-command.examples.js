import assert from "node:assert/strict";
import { AI_COMMAND_JSON_SCHEMA, AI_INTENT_VALUES, getAiSchemaSummary, normalizeAiCommand } from "../src/modules/ai/ai.command-schema.js";
import { getPermissionLevel, checkPermission } from "../src/modules/ai/ai.permissions.js";

assert.equal(AI_COMMAND_JSON_SCHEMA.strict, true, "AI command schema must be strict");
assert.equal(AI_COMMAND_JSON_SCHEMA.schema.additionalProperties, false, "AI schema should block extra root fields");

for (const field of [
  "intent",
  "confidence",
  "customer",
  "items",
  "payment",
  "target",
  "discount",
  "needsConfirmation",
  "clarificationNeeded",
  "clarificationQuestion",
  "messageToUser",
]) {
  assert.ok(AI_COMMAND_JSON_SCHEMA.schema.required.includes(field), `${field} must be required`);
}

for (const intent of [
  "SEARCH_PRODUCT",
  "ADD_ITEMS",
  "CONFIRM_BILL",
  "CANCEL_BILL",
  "UPDATE_PRODUCT_PRICE",
  "ADJUST_STOCK",
  "DELETE_PRODUCT",
  "EXPORT_DATA",
  "UNKNOWN",
]) {
  assert.ok(AI_INTENT_VALUES.includes(intent), `${intent} must be in allowed AI intents`);
}

assert.equal(getPermissionLevel("ADD_ITEMS"), "safe");
assert.equal(getPermissionLevel("CONFIRM_BILL"), "confirm");
assert.equal(getPermissionLevel("CANCEL_BILL"), "owner_pin");
assert.equal(getPermissionLevel("DELETE_PRODUCT"), "owner_pin");
assert.equal(getPermissionLevel("RUN_CODE"), "blocked");

assert.deepEqual(checkPermission({ intent: "ADD_ITEMS" }), { allowed: true, level: "safe" });
assert.deepEqual(checkPermission({ intent: "CONFIRM_BILL" }), { allowed: true, level: "confirm" });
assert.deepEqual(checkPermission({ intent: "ADJUST_STOCK" }), { allowed: true, level: "owner_pin" });
assert.equal(checkPermission({ intent: "DROP_DATABASE" }).allowed, false);

const normalized = normalizeAiCommand({
  intent: "ADD_ITEMS",
  confidence: 1.4,
  items: [{ query: "shakkar", quantity: 500, unit: "g" }],
  messageToUser: "Shakkar add kar diya.",
});
assert.equal(normalized.intent, "ADD_ITEMS");
assert.equal(normalized.confidence, 1, "confidence should be clamped to 1");
assert.equal(normalized.customer, null);
assert.equal(normalized.payment, null);
assert.equal(normalized.discount, null);

const unknown = normalizeAiCommand({ intent: "RUN_CODE", confidence: -5 });
assert.equal(unknown.intent, "UNKNOWN");
assert.equal(unknown.confidence, 0, "confidence should be clamped to 0");

const summary = getAiSchemaSummary();
assert.equal(summary.name, "kiranaos_ai_command");
assert.equal(summary.strict, true);
assert.ok(summary.intents.includes("UNKNOWN"));

console.log("AI command schema examples passed");
