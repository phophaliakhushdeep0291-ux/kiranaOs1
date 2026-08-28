import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString("base64");
const { default: db } = await import("../src/db.js");
const { disablePaymentConnection, listPaymentConnections, savePaymentConnection, selectPaymentConnection, verifyPaymentConnection } = await import("../src/modules/payment-provider/paymentConnections.service.js");

const suffix = crypto.randomUUID().slice(0, 8);
const shop = await db.shop.create({ data: { name: `Payments ${suffix}`, ownerName: "Owner", city: "Pune", address: "Test" } });
const otherShop = await db.shop.create({ data: { name: `Other ${suffix}`, ownerName: "Owner", city: "Pune", address: "Test" } });

async function withFailedAudit(action, operation) {
  assert.match(action, /^[A-Z0-9_]+$/);
  const uniqueId = crypto.randomUUID().replaceAll("-", "");
  const trigger = `force_payment_connection_audit_${uniqueId}`;
  const triggerFunction = `${trigger}_fn`;
  // DATABASE_URL only, because it is the connection Prisma is actually holding.
  //
  // The other two describe a database that may not be the one under test.
  // Importing src/db.js loads dotenv, which puts POSTGRES_TEST_DATABASE_URL back
  // from .env AFTER the isolated runner has cleared it — dotenv does not
  // overwrite DATABASE_URL, so the client stays on the SQLite file the runner
  // made while that variable still names a Postgres server. Reading it first
  // made this test emit `CREATE FUNCTION … plpgsql` at SQLite, which answered
  // `near "FUNCTION": syntax error` and took the whole suite red.
  //
  // The same one-variable check is what customers, products and reminders use
  // to decide whether a Postgres-only lock applies.
  const isPostgres = /^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL || "");

  if (isPostgres) {
    await db.$executeRawUnsafe(`
      CREATE FUNCTION "${triggerFunction}"() RETURNS trigger AS $$
      BEGIN
        IF NEW."action" = '${action}' THEN
          RAISE EXCEPTION 'forced payment connection audit failure';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${trigger}"
      BEFORE INSERT ON "AuditLog"
      FOR EACH ROW EXECUTE FUNCTION "${triggerFunction}"()
    `);
  } else {
    await db.$executeRawUnsafe(`
      CREATE TRIGGER "${trigger}"
      BEFORE INSERT ON "AuditLog"
      WHEN NEW."action" = '${action}'
      BEGIN
        SELECT RAISE(ABORT, 'forced payment connection audit failure');
      END
    `);
  }
  try {
    await assert.rejects(operation, (error) => error?.code === "PAYMENT_PROVIDER_AUDIT_WRITE_FAILED");
  } finally {
    if (isPostgres) {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}" ON "AuditLog"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS "${triggerFunction}"()`);
    } else {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS "${trigger}"`);
    }
  }
}

try {
  const saved = await savePaymentConnection({
    shopId: shop.id,
    provider: "razorpay",
    input: { environment: "test", keyId: "rzp_test_1234567890", keySecret: "secret-123456", webhookSecret: "webhook-123456" },
  });
  assert.equal(saved.selected, false);
  assert.equal(saved.webhookSecretConfigured, true);
  assert.ok(!JSON.stringify(saved).includes("secret-123456"));

  const stored = await db.paymentProviderConnection.findUnique({ where: { shopId_provider: { shopId: shop.id, provider: "razorpay" } } });
  assert.ok(stored.encryptedCredentials.startsWith("v1."));
  assert.ok(!stored.encryptedCredentials.includes("secret-123456"));
  assert.deepEqual(await listPaymentConnections(otherShop.id), []);

  const originalCiphertext = stored.encryptedCredentials;
  await withFailedAudit("PAYMENT_PROVIDER_CREDENTIALS_UPDATED", () => savePaymentConnection({
    shopId: shop.id,
    provider: "razorpay",
    input: { environment: "test", keyId: "rzp_test_replacement1", keySecret: "replacement-secret", webhookSecret: "replacement-webhook" },
  }));
  assert.equal(
    (await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).encryptedCredentials,
    originalCiphertext,
    "credential update must roll back when its audit row cannot be written",
  );

  await withFailedAudit("PAYMENT_PROVIDER_CREDENTIALS_VERIFIED", () => verifyPaymentConnection({
    shopId: shop.id,
    provider: "razorpay",
    verifyOverride: async () => ({ accountReachable: true }),
  }));
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).status, "configured");

  await verifyPaymentConnection({ shopId: shop.id, provider: "razorpay", verifyOverride: async () => ({ accountReachable: true }) });
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).status, "verified");

  let finishSlowVerification;
  let announceSlowVerification;
  const slowVerificationStarted = new Promise((resolve) => { announceSlowVerification = resolve; });
  const slowVerification = verifyPaymentConnection({
    shopId: shop.id,
    provider: "razorpay",
    verifyOverride: async () => {
      announceSlowVerification();
      await new Promise((resolve) => { finishSlowVerification = resolve; });
      return { accountReachable: true };
    },
  });
  await slowVerificationStarted;
  await savePaymentConnection({
    shopId: shop.id,
    provider: "razorpay",
    input: { environment: "test", keyId: "rzp_test_replacement2", keySecret: "replacement-secret", webhookSecret: "replacement-webhook" },
  });
  finishSlowVerification();
  await assert.rejects(slowVerification, (error) => error?.code === "PAYMENT_PROVIDER_VERIFICATION_CONFLICT");
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).status, "configured");

  await verifyPaymentConnection({ shopId: shop.id, provider: "razorpay", verifyOverride: async () => ({ accountReachable: true }) });

  await withFailedAudit("PAYMENT_PROVIDER_SELECTED", () => selectPaymentConnection({ shopId: shop.id, provider: "razorpay" }));
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).selected, false);
  const selected = await selectPaymentConnection({ shopId: shop.id, provider: "razorpay" });
  assert.equal(selected.selected, true);
  assert.equal((await listPaymentConnections(shop.id))[0].keyIdHint, selected.keyIdHint);

  await withFailedAudit("PAYMENT_PROVIDER_DISABLED", () => disablePaymentConnection({ shopId: shop.id, provider: "razorpay" }));
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).status, "verified");
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).selected, true);
  await disablePaymentConnection({ shopId: shop.id, provider: "razorpay" });
  assert.equal((await db.paymentProviderConnection.findUnique({ where: { id: stored.id } })).status, "disabled");

  const connectionAudits = await db.auditLog.findMany({
    where: { shopId: shop.id, entityType: "PaymentProviderConnection" },
    orderBy: { createdAt: "asc" },
  });
  assert.equal(connectionAudits.filter((row) => row.action === "PAYMENT_PROVIDER_CREDENTIALS_UPDATED").length, 2);
  assert.equal(connectionAudits.filter((row) => row.action === "PAYMENT_PROVIDER_CREDENTIALS_VERIFIED").length, 2);
  assert.equal(connectionAudits.filter((row) => row.action === "PAYMENT_PROVIDER_SELECTED").length, 1);
  assert.equal(connectionAudits.filter((row) => row.action === "PAYMENT_PROVIDER_DISABLED").length, 1);
  const serializedAudits = JSON.stringify(connectionAudits);
  for (const secret of ["secret-123456", "webhook-123456", "replacement-secret", "replacement-webhook"]) {
    assert.ok(!serializedAudits.includes(secret), "audit history must never contain payment credentials");
  }

  await assert.rejects(
    savePaymentConnection({ shopId: shop.id, provider: "razorpay", input: { environment: "live", keyId: "rzp_test_wrong", keySecret: "secret-123456", webhookSecret: "webhook-123456" } }),
    /live credentials/i,
  );
} finally {
  await db.$disconnect();
}

console.log("Payment provider connection examples passed");
