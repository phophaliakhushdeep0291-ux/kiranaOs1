import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.PAYMENT_CREDENTIALS_ENCRYPTION_KEY ||= Buffer.alloc(32, 9).toString("base64");
const { default: db } = await import("../src/db.js");
const { listPaymentConnections, savePaymentConnection, selectPaymentConnection } = await import("../src/modules/payment-provider/paymentConnections.service.js");

const suffix = crypto.randomUUID().slice(0, 8);
const shop = await db.shop.create({ data: { name: `Payments ${suffix}`, ownerName: "Owner", city: "Pune", address: "Test" } });
const otherShop = await db.shop.create({ data: { name: `Other ${suffix}`, ownerName: "Owner", city: "Pune", address: "Test" } });

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

  await db.paymentProviderConnection.update({ where: { id: stored.id }, data: { status: "verified", verifiedAt: new Date() } });
  const selected = await selectPaymentConnection({ shopId: shop.id, provider: "razorpay" });
  assert.equal(selected.selected, true);
  assert.equal((await listPaymentConnections(shop.id))[0].keyIdHint, saved.keyIdHint);

  await assert.rejects(
    savePaymentConnection({ shopId: shop.id, provider: "razorpay", input: { environment: "live", keyId: "rzp_test_wrong", keySecret: "secret-123456", webhookSecret: "webhook-123456" } }),
    /live credentials/i,
  );
} finally {
  await db.$disconnect();
}

console.log("Payment provider connection examples passed");
