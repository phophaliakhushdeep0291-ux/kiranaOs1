import assert from "node:assert/strict";
import http from "node:http";
import process from "node:process";
import {
  buildTestEnv,
  getTestDatabaseUrl,
  isKnownPrismaRuntimeUnavailable,
  maskDatabaseUrl,
  shouldGracefullySkipPrismaRuntime,
} from "../../scripts/test-db-utils.js";

Object.assign(process.env, buildTestEnv());

export const TEST_DATABASE_URL = getTestDatabaseUrl();

export async function createIntegrationContext() {
  let db;
  let app;

  try {
    ({ default: db } = await import("../../src/db.js"));
    ({ default: app } = await import("../../src/app.js"));
    await db.$connect();
    await db.$queryRaw`SELECT 1`;
  } catch (error) {
    if (isKnownPrismaRuntimeUnavailable(error) && shouldGracefullySkipPrismaRuntime()) {
      return {
        skip: true,
        reason:
          "Prisma query engine/runtime is unavailable in this sandbox. " +
          "Run `npm install`, `npm run setup:test-db`, and `npm run test:db` on a real machine/CI. " +
          `Configured test DB: ${maskDatabaseUrl(TEST_DATABASE_URL)}`,
      };
    }
    throw error;
  }

  const server = http.createServer(app);
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  const defaultDeviceByToken = new Map();
  const defaultDevicePromiseByToken = new Map();

  async function rawRequest(method, urlPath, { token, body, headers, ownerPin } = {}) {
    const response = await fetch(`${baseUrl}${urlPath}`, {
      method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(ownerPin ? { "x-owner-pin": ownerPin } : {}),
        ...(headers || {}),
      },
      ...(body !== undefined ? { body: JSON.stringify(body, jsonReplacer) } : {}),
    });

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = { raw: text };
    }

    return { status: response.status, ok: response.ok, body: json, text };
  }

  async function ensureDefaultDevice(token) {
    if (!token) return null;
    if (defaultDeviceByToken.has(token)) return defaultDeviceByToken.get(token);
    if (defaultDevicePromiseByToken.has(token)) return defaultDevicePromiseByToken.get(token);

    const promise = (async () => {
      const deviceId = `integration-device-${String(token).slice(-12).replace(/[^a-zA-Z0-9_-]/g, "")}-${Date.now()}`;
      const response = await rawRequest("POST", "/api/devices/activate", {
        token,
        body: {
          deviceId,
          deviceName: "Integration Default Device",
          platform: "test",
          fingerprintHash: `fp-${deviceId}`,
        },
      });

      if (response.status !== 201 && response.status !== 200) {
        throw new Error(`Default device activation failed: ${response.status} ${JSON.stringify(response.body)}`);
      }

      const activatedDeviceId = response.body?.data?.deviceId || deviceId;
      defaultDeviceByToken.set(token, activatedDeviceId);
      return activatedDeviceId;
    })();

    defaultDevicePromiseByToken.set(token, promise);
    try {
      return await promise;
    } finally {
      defaultDevicePromiseByToken.delete(token);
    }
  }

  function shouldAutoAttachDevice(urlPath, headers = {}, autoDevice = true) {
    if (!autoDevice) return false;
    if (headers?.["x-device-id"] || headers?.["X-Device-Id"]) return false;
    // Tests that intentionally assert DEVICE_REQUIRED must be able to omit the header.
    if (urlPath.startsWith("/api/sync")) return false;
    if (urlPath.startsWith("/api/devices/license")) return false;
    return true;
  }

  async function request(method, urlPath, { token, body, headers, ownerPin, autoDevice = true } = {}) {
    const response = await rawRequest(method, urlPath, { token, body, headers, ownerPin });

    // Phase 25: after device enforcement, integration tests should prove real
    // active-device access instead of accidentally failing all protected routes.
    // If a protected route responds DEVICE_REQUIRED, lazily activate one test
    // device for this token and retry exactly once. Device-license/sync tests can
    // disable this by passing autoDevice:false or by targeting /api/sync.
    if (
      token &&
      response.status === 400 &&
      response.body?.code === "DEVICE_REQUIRED" &&
      shouldAutoAttachDevice(urlPath, headers, autoDevice)
    ) {
      const deviceId = await ensureDefaultDevice(token);
      return rawRequest(method, urlPath, {
        token,
        body,
        ownerPin,
        headers: { ...(headers || {}), "x-device-id": deviceId },
      });
    }

    return response;
  }


  return {
    skip: false,
    db,
    app,
    baseUrl,
    request,
    get: (path, opts) => request("GET", path, opts),
    post: (path, body, opts = {}) => request("POST", path, { ...opts, body }),
    patch: (path, body, opts = {}) => request("PATCH", path, { ...opts, body }),
    delete: (path, opts = {}) => request("DELETE", path, opts),
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      await db.$disconnect();
    },
  };
}

function jsonReplacer(_key, value) {
  if (typeof value !== "bigint") return value;
  const asNumber = Number(value);
  return Number.isSafeInteger(asNumber) ? asNumber : value.toString();
}

export async function resetDatabase(db) {
  await db.$transaction([
    db.pricingDecisionEvent.deleteMany(),
    db.billItemLotAllocation.deleteMany(),
    db.inventoryLot.deleteMany(),
    db.purchaseReturnItem.deleteMany(),
    db.purchaseReturn.deleteMany(),
    db.customerOrder.deleteMany(),
    db.giftCardTransaction.deleteMany(),
    db.giftCard.deleteMany(),
    db.stockCountLine.deleteMany(),
    db.stockCountSession.deleteMany(),
    db.purchaseReceiptItem.deleteMany(),
    db.purchaseReceipt.deleteMany(),
    db.purchaseOrderItem.deleteMany(),
    db.purchaseOrder.deleteMany(),
    db.complianceDocument.deleteMany(),
    db.retailPaymentIntent.deleteMany(),
    db.loyaltyTransaction.deleteMany(),
    db.loyaltyAccount.deleteMany(),
    db.loyaltyProgram.deleteMany(),
    db.stockTransferItem.deleteMany(),
    db.stockTransfer.deleteMany(),
    db.pricingRule.deleteMany(),
    db.locationStock.deleteMany(),
    db.userLocationAccess.deleteMany(),
    db.storeLocation.deleteMany(),
    db.webhookDelivery.deleteMany(),
    db.webhookEndpoint.deleteMany(),
    db.integrationApiKey.deleteMany(),
    db.deviceReplacementChallenge.deleteMany(),
    db.deviceLicense.deleteMany(),
    db.device.deleteMany(),
    db.reportExportJob.deleteMany(),
    db.reminderLog.deleteMany(),
    db.reminderTemplate.deleteMany(),
    db.dailyClosingSnapshot.deleteMany(),
    db.paymentProviderEvent.deleteMany(),
    db.paymentTransaction.deleteMany(),
    db.subscription.deleteMany(),
    db.plan.deleteMany(),
    db.offlineSyncEvent.deleteMany(),
    db.syncIdMapping.deleteMany(),
    db.syncCommand.deleteMany(),
    db.changeLog.deleteMany(),
    db.financialLedger.deleteMany(),
    db.auditLog.deleteMany(),
    db.aiActionLog.deleteMany(),
    db.offer.deleteMany(),
    db.expense.deleteMany(),
    db.purchaseHistory.deleteMany(),
    db.stockLedger.deleteMany(),
    db.udharLedger.deleteMany(),
    db.payment.deleteMany(),
    db.billItem.deleteMany(),
    db.productSellingUnit.deleteMany(),
    db.bill.deleteMany(),
    db.billCounter.deleteMany(),
    db.supplier.deleteMany(),
    db.product.deleteMany(),
    db.customer.deleteMany(),
    db.authToken.deleteMany(),
    db.session.deleteMany(),
    db.user.deleteMany(),
    // Database sync triggers intentionally log hard deletes. Clear those fresh
    // tombstones only in the test reset, after every sync-visible root is gone.
    db.changeLog.deleteMany(),
    db.shop.deleteMany(),
  ]);
}

export function assertSuccess(response, expectedStatus = 200) {
  assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
  assert.equal(response.body?.success, true, JSON.stringify(response.body));
  return response.body.data;
}

export function assertFailure(response, expectedStatus) {
  assert.equal(response.status, expectedStatus, JSON.stringify(response.body));
  assert.equal(response.body?.success, false, JSON.stringify(response.body));
  return response.body;
}

export function todayRangeQuery() {
  const from = new Date();
  from.setHours(0, 0, 0, 0);
  const to = new Date();
  to.setHours(23, 59, 59, 999);
  return `from=${encodeURIComponent(from.toISOString())}&to=${encodeURIComponent(to.toISOString())}`;
}
