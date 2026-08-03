import assert from "node:assert/strict";
import db from "../src/db.js";
import { applySettingRepair, listSettingRepairs, readRepairableSettings } from "../src/modules/remote-support/settingsRepair.service.js";
import { SETTING_KEYS, getSettingRepair } from "../src/modules/remote-support/settings.catalog.js";
import { COMMAND_SCOPES } from "../src/modules/remote-support/commands.catalog.js";
import { validateGstin } from "../src/utils/gst.js";

// APPLY_SETTING is the only remote-support path that writes the shop's own data,
// so every assertion here is about what it REFUSES to do. A support tool that can
// quietly change a business's tax identity is a liability, not a feature.

const suffix = `settings-repair-${Date.now()}`;
// A real, checksum-valid GSTIN (27 = Maharashtra) — the validator rejects invented ones.
const VALID_GSTIN = "27AAPFU0939F1ZV";
let shopA;
let shopB;
let locationA;

function sessionFor(shop, overrides = {}) {
  return {
    id: `session-${shop.id}`,
    shopId: shop.id,
    scope: COMMAND_SCOPES.REPAIR,
    operatorEmail: "operator@example.com",
    ...overrides,
  };
}

async function expectRejection(promise, code, message) {
  try {
    await promise;
    assert.fail(`${message} — expected rejection with ${code}, but it resolved`);
  } catch (error) {
    assert.equal(error.code, code, `${message} (got: ${error.message})`);
  }
}

async function main() {
  shopA = await db.shop.create({ data: { name: `A ${suffix}`, ownerName: "A", city: "X", address: "Y" } });
  shopB = await db.shop.create({ data: { name: `B ${suffix}`, ownerName: "B", city: "X", address: "Y" } });
  locationA = await db.storeLocation.create({
    data: { shopId: shopA.id, code: "MAIN", name: "Main Counter", isPrimary: true },
  });
  await db.storeLocation.create({
    data: { shopId: shopB.id, code: "MAIN", name: "Other Shop", isPrimary: true },
  });

  // The fixture must be the real thing, or every validation assertion below is
  // testing nothing.
  assert.ok(validateGstin(VALID_GSTIN).valid, "the test GSTIN is checksum-valid");

  // 1) The catalog is small and every entry is reachable. A key that cannot be
  //    read is a key an operator will try to write blind.
  assert.ok(SETTING_KEYS.length > 0 && SETTING_KEYS.length <= 6, "the allowlist stays small");
  for (const key of SETTING_KEYS) {
    const repair = getSettingRepair(key);
    assert.equal(typeof repair.apply, "function", `${key} can be applied`);
    assert.equal(typeof repair.read, "function", `${key} can be read`);
    assert.ok(repair.description, `${key} explains itself to an operator`);
  }

  // 2) A key outside the catalog cannot be written, however it is spelled. There
  //    is no path-based setter, so "shop.plan" or "user.role" simply do not exist.
  for (const forged of ["shop.plan", "user.role", "settingsJson", "__proto__", "location.gstNumber "]) {
    await expectRejection(
      applySettingRepair({ session: sessionFor(shopA), key: forged, value: VALID_GSTIN }),
      "SETTING_NOT_ALLOWED",
      `"${forged}" is not repairable`,
    );
  }

  // 3) A diagnose-only session cannot change anything. "Let them look only" has to
  //    mean it here most of all.
  await expectRejection(
    applySettingRepair({
      session: sessionFor(shopA, { scope: COMMAND_SCOPES.DIAGNOSE }),
      key: "location.gstNumber",
      value: VALID_GSTIN,
    }),
    "SETTING_SCOPE_DENIED",
    "a read-only session cannot write a setting",
  );

  // 4) A malformed GSTIN is refused, and so is one that only LOOKS right — the
  //    checksum is what stops a typo becoming a year of wrong invoices.
  await expectRejection(
    applySettingRepair({ session: sessionFor(shopA), key: "location.gstNumber", value: "NOTAGSTIN" }),
    "SETTING_VALUE_INVALID",
    "a malformed GSTIN is refused",
  );
  await expectRejection(
    applySettingRepair({ session: sessionFor(shopA), key: "location.gstNumber", value: "27AAPFU0939F1ZZ" }),
    "SETTING_VALUE_INVALID",
    "a GSTIN with a bad checksum is refused",
  );

  // 5) A value-taking repair needs a value; a reset must not be given one.
  await expectRejection(
    applySettingRepair({ session: sessionFor(shopA), key: "location.gstNumber", value: "  " }),
    "SETTING_VALUE_REQUIRED",
    "an empty GSTIN is refused rather than blanking the field",
  );
  await expectRejection(
    applySettingRepair({ session: sessionFor(shopA), key: "settings.moduleVisibility", value: "something" }),
    "SETTING_VALUE_UNEXPECTED",
    "a reset does not quietly accept a value",
  );

  // 6) The real repair: the case this command exists for.
  const before = await readRepairableSettings({ shopId: shopA.id });
  const gstEntry = before.find((entry) => entry.key === "location.gstNumber");
  assert.equal(gstEntry.currentValue, null, "the location starts with no GSTIN — the stranded state");
  assert.equal(gstEntry.context.locationName, "Main Counter", "the operator sees which location they are fixing");

  const applied = await applySettingRepair({
    session: sessionFor(shopA),
    key: "location.gstNumber",
    value: VALID_GSTIN.toLowerCase(), // operators paste what the shopkeeper texts them
    reason: "GST invoices blocked",
  });
  assert.equal(applied.after.gstNumber, VALID_GSTIN, "the GSTIN is normalised to upper case");
  assert.equal(applied.after.gstStateCode, "27", "the state code is DERIVED, never typed");
  assert.equal(applied.before.gstNumber, null, "the previous value is captured");

  const stored = await db.storeLocation.findUnique({ where: { id: locationA.id } });
  assert.equal(stored.gstNumber, VALID_GSTIN, "the write actually landed");
  assert.equal(stored.gstStateCode, "27");

  // 7) It is in the audit trail with before AND after — the only record that can
  //    answer "what was this set to before support touched it?"
  const auditRow = await db.auditLog.findFirst({
    where: { shopId: shopA.id, action: "SUPPORT_SETTING_REPAIRED" },
    orderBy: { createdAt: "desc" },
  });
  assert.ok(auditRow, "the repair is audited");
  assert.equal(auditRow.module, "settings");
  assert.equal(auditRow.entityId, "location.gstNumber");
  assert.equal(JSON.parse(auditRow.beforeJson).gstNumber, null, "before value recorded");
  assert.equal(JSON.parse(auditRow.afterJson).gstNumber, VALID_GSTIN, "after value recorded");
  assert.equal(JSON.parse(auditRow.metadataJson).operatorEmail, "operator@example.com", "and who did it");

  // 8) The owner can see what was changed, in their own shop's history.
  const history = await listSettingRepairs({ shopId: shopA.id });
  assert.equal(history.length, 1);
  assert.equal(history[0].label, "GSTIN on a store location", "shown by label, not by internal key");
  assert.equal(history[0].reason, "GST invoices blocked");

  // 9) Tenant isolation: a session for shop A cannot reach shop B's location, even
  //    when handed its id directly.
  const shopBLocation = await db.storeLocation.findFirst({ where: { shopId: shopB.id } });
  await expectRejection(
    applySettingRepair({
      session: sessionFor(shopA),
      key: "location.gstNumber",
      value: VALID_GSTIN,
      locationId: shopBLocation.id,
    }),
    "SETTING_TARGET_MISSING",
    "another shop's location is invisible to this session",
  );
  const untouched = await db.storeLocation.findUnique({ where: { id: shopBLocation.id } });
  assert.equal(untouched.gstNumber, null, "and it was not written");

  // 10) The lockout escape: an owner who hid the settings section gets it back.
  await db.shop.update({
    where: { id: shopA.id },
    data: { settingsJson: JSON.stringify({ moduleVisibility: { settings: false, reports: false }, pricing: { keep: true } }) },
  });

  const hiddenView = await readRepairableSettings({ shopId: shopA.id });
  const moduleEntry = hiddenView.find((entry) => entry.key === "settings.moduleVisibility");
  assert.equal(moduleEntry.context.hiddenCount, 2, "the operator can see how many sections are hidden");

  const reset = await applySettingRepair({ session: sessionFor(shopA), key: "settings.moduleVisibility" });
  assert.equal(reset.after.moduleVisibility, null, "the visibility map is cleared back to the default");

  const afterReset = await db.shop.findUnique({ where: { id: shopA.id }, select: { settingsJson: true } });
  const parsed = JSON.parse(afterReset.settingsJson);
  assert.equal(parsed.moduleVisibility, undefined, "the key is removed, not set to a map of trues");
  assert.deepEqual(parsed.pricing, { keep: true }, "and no other setting was collateral damage");

  console.log("remote-support-settings.examples.js OK");
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    const ids = [shopA?.id, shopB?.id].filter(Boolean);
    try {
      await db.deviceCommand.deleteMany({ where: { shopId: { in: ids } } });
      await db.storeLocation.deleteMany({ where: { shopId: { in: ids } } });
      await db.auditLog.deleteMany({ where: { shopId: { in: ids } } });
      await db.shop.deleteMany({ where: { id: { in: ids } } });
    } catch (cleanupError) {
      console.error("cleanup failed", cleanupError);
    }
    await db.$disconnect();
  });
