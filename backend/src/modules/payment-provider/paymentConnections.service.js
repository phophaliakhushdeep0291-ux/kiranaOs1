import db from "../../db.js";
import { AppError } from "../../middleware/error.js";
import { createAuditLog } from "../audit/audit.service.js";
import { decryptPaymentCredentials, encryptPaymentCredentials } from "./paymentCredentials.crypto.js";
import { verifyRazorpayCredentials } from "./razorpay.provider.js";

const PROVIDERS = Object.freeze({
  razorpay: { verify: verifyRazorpayCredentials, keyPrefixes: { test: "rzp_test_", live: "rzp_live_" } },
});

function publicConnection(row) {
  return {
    id: row.id, provider: row.provider, environment: row.environment,
    keyIdHint: row.keyIdHint, webhookSecretConfigured: row.webhookSecretConfigured,
    selected: row.selected, status: row.status,
    verifiedAt: row.verifiedAt?.toISOString?.() ?? null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString?.() ?? null,
    webhookPath: `/api/payment-provider/webhooks/${row.provider}/${row.id}`,
    updatedAt: row.updatedAt.toISOString(),
  };
}

function assertProvider(provider) {
  const adapter = PROVIDERS[provider];
  if (!adapter) throw new AppError("Payment provider is not supported", 400, "PAYMENT_PROVIDER_UNSUPPORTED");
  return adapter;
}

function credentialsContext(shopId, provider) { return `payment-provider:${shopId}:${provider}`; }

export async function listPaymentConnections(shopId) {
  const rows = await db.paymentProviderConnection.findMany({ where: { shopId }, orderBy: [{ selected: "desc" }, { provider: "asc" }] });
  return rows.map(publicConnection);
}

/** Internal only: callers must never serialize the returned credentials. */
export async function getSelectedPaymentConnection(shopId, provider = null) {
  const row = await db.paymentProviderConnection.findFirst({
    where: { shopId, selected: true, status: "verified", ...(provider ? { provider } : {}) },
  });
  if (!row) return null;
  return { ...row, credentials: decryptPaymentCredentials(row.encryptedCredentials, credentialsContext(shopId, row.provider)) };
}

export async function getPaymentConnectionForWebhook(id, provider) {
  const row = await db.paymentProviderConnection.findFirst({ where: { id, provider, selected: true, status: "verified" } });
  if (!row || !row.webhookSecretConfigured) return null;
  return { ...row, credentials: decryptPaymentCredentials(row.encryptedCredentials, credentialsContext(row.shopId, row.provider)) };
}

export async function savePaymentConnection({ shopId, userId, provider, input, req }) {
  const adapter = assertProvider(provider);
  const expectedPrefix = adapter.keyPrefixes[input.environment];
  if (!input.keyId.startsWith(expectedPrefix)) {
    throw new AppError(`Razorpay ${input.environment} credentials must use a ${expectedPrefix} key`, 400, "PAYMENT_CREDENTIAL_ENVIRONMENT_MISMATCH");
  }
  const encryptedCredentials = encryptPaymentCredentials({ keyId: input.keyId, keySecret: input.keySecret, webhookSecret: input.webhookSecret }, credentialsContext(shopId, provider));
  const keyIdHint = `${input.keyId.slice(0, Math.min(12, input.keyId.length))}…${input.keyId.slice(-4)}`;
  const row = await db.paymentProviderConnection.upsert({
    where: { shopId_provider: { shopId, provider } },
    create: { shopId, provider, environment: input.environment, encryptedCredentials, keyIdHint, webhookSecretConfigured: Boolean(input.webhookSecret), status: "configured", selected: false, createdByUserId: userId || null, updatedByUserId: userId || null },
    update: { environment: input.environment, encryptedCredentials, keyIdHint, webhookSecretConfigured: Boolean(input.webhookSecret), status: "configured", selected: false, verifiedAt: null, lastVerifiedAt: null, updatedByUserId: userId || null },
  });
  await createAuditLog({ shopId, userId, action: "PAYMENT_PROVIDER_CREDENTIALS_UPDATED", entityType: "PaymentProviderConnection", entityId: row.id, after: { provider, environment: input.environment, keyIdHint, webhookSecretConfigured: Boolean(input.webhookSecret) }, req });
  return publicConnection(row);
}

export async function verifyPaymentConnection({ shopId, userId, provider, req }) {
  const adapter = assertProvider(provider);
  const row = await db.paymentProviderConnection.findUnique({ where: { shopId_provider: { shopId, provider } } });
  if (!row) throw new AppError("Payment provider connection was not found", 404, "PAYMENT_PROVIDER_CONNECTION_NOT_FOUND");
  const credentials = decryptPaymentCredentials(row.encryptedCredentials, credentialsContext(shopId, provider));
  await adapter.verify(credentials);
  const now = new Date();
  const updated = await db.paymentProviderConnection.update({ where: { id: row.id }, data: { status: "verified", verifiedAt: row.verifiedAt || now, lastVerifiedAt: now, updatedByUserId: userId || null } });
  await createAuditLog({ shopId, userId, action: "PAYMENT_PROVIDER_CREDENTIALS_VERIFIED", entityType: "PaymentProviderConnection", entityId: row.id, after: { provider, environment: row.environment }, req });
  return publicConnection(updated);
}

export async function selectPaymentConnection({ shopId, userId, provider, req }) {
  assertProvider(provider);
  const row = await db.paymentProviderConnection.findUnique({ where: { shopId_provider: { shopId, provider } } });
  if (!row) throw new AppError("Payment provider connection was not found", 404, "PAYMENT_PROVIDER_CONNECTION_NOT_FOUND");
  if (row.status !== "verified") throw new AppError("Verify the provider credentials before selecting them", 409, "PAYMENT_PROVIDER_NOT_VERIFIED");
  const updated = await db.$transaction(async (tx) => {
    await tx.paymentProviderConnection.updateMany({ where: { shopId, selected: true }, data: { selected: false } });
    return tx.paymentProviderConnection.update({ where: { id: row.id }, data: { selected: true, updatedByUserId: userId || null } });
  });
  await createAuditLog({ shopId, userId, action: "PAYMENT_PROVIDER_SELECTED", entityType: "PaymentProviderConnection", entityId: row.id, after: { provider, environment: row.environment }, req });
  return publicConnection(updated);
}

export async function disablePaymentConnection({ shopId, userId, provider, req }) {
  assertProvider(provider);
  const result = await db.paymentProviderConnection.updateMany({ where: { shopId, provider }, data: { selected: false, status: "disabled", updatedByUserId: userId || null } });
  if (!result.count) throw new AppError("Payment provider connection was not found", 404, "PAYMENT_PROVIDER_CONNECTION_NOT_FOUND");
  await createAuditLog({ shopId, userId, action: "PAYMENT_PROVIDER_DISABLED", entityType: "PaymentProviderConnection", after: { provider }, req });
  return { disabled: true, provider };
}
