import assert from "node:assert/strict";
import test from "node:test";
import { assertFailure, assertSuccess, createIntegrationContext, resetDatabase } from "./setup.js";
import { createStaff, createTenant, login } from "./factories.js";

test("unknown terminal money is branch-blocking, owner-PIN reconciled and auditable", async (t) => {
  const ctx = await createIntegrationContext();
  if (ctx.skip) {
    t.skip(ctx.reason);
    return;
  }

  try {
    await resetDatabase(ctx.db);
    const tenant = await createTenant(ctx.db);
    const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
    const location = await ctx.db.storeLocation.create({
      data: { shopId: tenant.shop.id, code: "MAIN", name: "Main Store", isPrimary: true },
    });

    const uncertain = await createUncertainIntent(ctx.db, tenant, location, "terminal-unknown-1", 12_500);
    const status = assertSuccess(await ctx.get(`/api/payment-provider/terminal/charges/${uncertain.id}/status`, { token: auth.accessToken }));
    assert.equal(status.status, "uncertain");
    assert.equal(status.requiresReconciliation, true);

    const cancel = assertFailure(await ctx.post(`/api/payment-provider/terminal/charges/${uncertain.id}/cancel`, {}, { token: auth.accessToken }), 409);
    assert.equal(cancel.code, "CARD_TERMINAL_RECONCILIATION_REQUIRED");

    const noPin = assertFailure(await ctx.post(`/api/payment-provider/terminal/charges/${uncertain.id}/reconcile`, {
      outcome: "charged",
      providerPaymentId: "RRN-12500-ONE",
      reason: "Matched terminal settlement report",
    }, { token: auth.accessToken }), 403);
    assert.match(noPin.error, /PIN required/i);

    const missingReference = assertFailure(await ctx.post(`/api/payment-provider/terminal/charges/${uncertain.id}/reconcile`, {
      outcome: "charged",
      reason: "Matched terminal settlement report",
    }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 400);
    assert.equal(missingReference.code, "VALIDATION_FAILED");

    const confirmed = assertSuccess(await ctx.post(`/api/payment-provider/terminal/charges/${uncertain.id}/reconcile`, {
      outcome: "charged",
      providerPaymentId: "RRN-12500-ONE",
      reason: "Matched terminal settlement report",
    }, { token: auth.accessToken, ownerPin: tenant.ownerPin }));
    assert.equal(confirmed.status, "confirmed");
    assert.equal(confirmed.confirmationSource, "owner_provider_reconciliation");
    assert.equal(confirmed.requiresReconciliation, false);

    const stored = await ctx.db.retailPaymentIntent.findUnique({ where: { id: uncertain.id } });
    assert.equal(stored.providerPaymentId, "RRN-12500-ONE");
    assert.ok(stored.confirmedAt);
    const chargedAudit = await ctx.db.auditLog.findFirst({
      where: { shopId: tenant.shop.id, action: "CARD_TERMINAL_UNCERTAIN_RECONCILED", entityId: uncertain.id },
    });
    assert.ok(chargedAudit, "the financial resolution must have an audit row");
    assert.match(chargedAudit.metadataJson, /Matched terminal settlement report/);
    assert.doesNotMatch(chargedAudit.metadataJson, new RegExp(tenant.ownerPin), "owner PIN must never enter reconciliation metadata");

    const duplicate = await createUncertainIntent(ctx.db, tenant, location, "terminal-unknown-2", 9_900);
    const duplicateReference = assertFailure(await ctx.post(`/api/payment-provider/terminal/charges/${duplicate.id}/reconcile`, {
      outcome: "charged",
      providerPaymentId: "RRN-12500-ONE",
      reason: "Second attempted use",
    }, { token: auth.accessToken, ownerPin: tenant.ownerPin }), 409);
    assert.equal(duplicateReference.code, "CARD_TERMINAL_PAYMENT_REFERENCE_REUSED");
    assert.equal((await ctx.db.retailPaymentIntent.findUnique({ where: { id: duplicate.id } })).status, "uncertain");

    // A staff cashier may obtain the owner's in-person PIN approval at the same
    // activated counter; the audit still attributes the decision to that staff
    // session instead of pretending the owner was logged in.
    const staffFixture = await createStaff(ctx.db, tenant.shop.id);
    const staffAuth = await login(ctx, staffFixture.staffMobile, staffFixture.staffPassword);
    const notCharged = assertSuccess(await ctx.post(`/api/payment-provider/terminal/charges/${duplicate.id}/reconcile`, {
      outcome: "not_charged",
      reason: "No matching transaction in terminal batch",
    }, { token: staffAuth.accessToken, ownerPin: tenant.ownerPin }));
    assert.equal(notCharged.status, "failed");
    assert.match(notCharged.failureReason, /Owner verified not charged/);
    const notChargedAudit = await ctx.db.auditLog.findFirst({
      where: { shopId: tenant.shop.id, action: "CARD_TERMINAL_UNCERTAIN_RECONCILED", entityId: duplicate.id },
    });
    assert.equal(notChargedAudit.userId, staffFixture.staff.id);
  } finally {
    await ctx.close?.();
  }
});

function createUncertainIntent(db, tenant, location, id, amountPaise) {
  return db.retailPaymentIntent.create({
    data: {
      id,
      shopId: tenant.shop.id,
      locationId: location.id,
      provider: "pine_labs",
      checkoutMode: "terminal",
      amountPaise,
      status: "uncertain",
      createdByUserId: tenant.owner.id,
      expiresAt: new Date(Date.now() + 3 * 60_000),
      failureReason: "Pine Labs terminal request timed out",
    },
  });
}
