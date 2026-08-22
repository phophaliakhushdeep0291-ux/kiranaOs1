import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createCustomer, createStaff, createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

async function forceAuditFailure(action, operation) {
  const triggerName = `force_${action.toLowerCase()}_audit_failure`;
  await ctx.db.$executeRawUnsafe(`
    CREATE TRIGGER ${triggerName}
    BEFORE INSERT ON AuditLog
    WHEN NEW.action = '${action}'
    BEGIN
      SELECT RAISE(ABORT, 'forced audit failure');
    END;
  `);
  try {
    return await operation();
  } finally {
    await ctx.db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS ${triggerName}`);
  }
}

if (ctx.skip) {
  test("settings/reminders integration tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("atomic settings and reminder configuration", () => {
    test("rolls back shop settings and setup status when their required audit fails", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "pro", city: "Jodhpur" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      assertSuccess(await ctx.get("/api/shops", { token: auth.accessToken }));

      const failedSettings = await forceAuditFailure("SETTINGS_CHANGED", () => ctx.patch(
        "/api/shops",
        { city: "Jaipur" },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(assertFailure(failedSettings, 503).code, "AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.shop.findUniqueOrThrow({ where: { id: tenant.shop.id } })).city, "Jodhpur");

      const saved = assertSuccess(await ctx.patch(
        "/api/shops",
        { city: "Jaipur" },
        { token: auth.accessToken, ownerPin: tenant.ownerPin },
      ));
      assert.equal(saved.city, "Jaipur");
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "SETTINGS_CHANGED" } }), 1);

      const failedSetup = await forceAuditFailure("SHOP_SETUP_STATUS_CHANGED", () => ctx.patch(
        "/api/shops/setup-status",
        { status: "complete" },
        { token: auth.accessToken },
      ));
      assert.equal(assertFailure(failedSetup, 503).code, "AUDIT_WRITE_FAILED");
      const afterFailure = JSON.parse((await ctx.db.shop.findUniqueOrThrow({ where: { id: tenant.shop.id } })).settingsJson || "{}");
      assert.notEqual(afterFailure.businessProfile?.setupStatus, "complete");

      const completed = assertSuccess(await ctx.patch(
        "/api/shops/setup-status",
        { status: "complete" },
        { token: auth.accessToken },
      ));
      assert.equal(completed.setupStatus, "complete");
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "SHOP_SETUP_STATUS_CHANGED" } }), 1);
    });

    test("rolls back reminder template create, update and delete when auditing fails", async () => {
      const tenant = await createTenant(ctx.db, { planCode: "pro" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      assertSuccess(await ctx.get("/api/reminders/templates", { token: auth.accessToken }));

      const templateBody = {
        name: "Credit reminder",
        channel: "whatsapp",
        templateText: "Hello {{customerName}}, your balance is {{balance}}.",
      };
      const failedCreate = await forceAuditFailure("REMINDER_TEMPLATE_CREATED", () => ctx.post(
        "/api/reminders/templates",
        templateBody,
        { token: auth.accessToken },
      ));
      assert.equal(assertFailure(failedCreate, 503).code, "AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.reminderTemplate.count({ where: { shopId: tenant.shop.id, name: templateBody.name } }), 0);

      const created = assertSuccess(await ctx.post(
        "/api/reminders/templates",
        templateBody,
        { token: auth.accessToken },
      ), 201);
      const failedUpdate = await forceAuditFailure("REMINDER_TEMPLATE_UPDATED", () => ctx.patch(
        `/api/reminders/templates/${created.id}`,
        { name: "Changed name" },
        { token: auth.accessToken },
      ));
      assert.equal(assertFailure(failedUpdate, 503).code, "AUDIT_WRITE_FAILED");
      assert.equal((await ctx.db.reminderTemplate.findUniqueOrThrow({ where: { id: created.id } })).name, templateBody.name);

      const failedDelete = await forceAuditFailure("REMINDER_TEMPLATE_DELETED", () => ctx.delete(
        `/api/reminders/templates/${created.id}`,
        { token: auth.accessToken },
      ));
      assert.equal(assertFailure(failedDelete, 503).code, "AUDIT_WRITE_FAILED");
      const afterDeleteFailure = await ctx.db.reminderTemplate.findUniqueOrThrow({ where: { id: created.id } });
      assert.equal(afterDeleteFailure.deletedAt, null);
      assert.equal(afterDeleteFailure.active, true);

      assertSuccess(await ctx.delete(`/api/reminders/templates/${created.id}`, { token: auth.accessToken }));
      const deleted = await ctx.db.reminderTemplate.findUniqueOrThrow({ where: { id: created.id } });
      assert.ok(deleted.deletedAt);
      assert.equal(deleted.active, false);
    });

    test("persists reminder requests atomically and claims provider dispatch at most once", async () => {
      const { claimReminderForDispatch, markReminderFromProvider, __remindersInternals } = await import("../../src/modules/reminders/reminders.service.js");
      const tenant = await createTenant(ctx.db, { planCode: "pro" });
      const auth = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);
      const customer = await createCustomer(ctx.db, tenant.shop.id, { name: "Reminder Customer", udharAmount: 500, mobile: "9876543210" });
      assertSuccess(await ctx.get("/api/reminders/templates", { token: auth.accessToken }));

      const failedRequest = await forceAuditFailure("REMINDER_REQUESTED", () => ctx.post(
        "/api/reminders/send",
        { customerId: customer.id, channel: "whatsapp" },
        { token: auth.accessToken },
      ));
      assert.equal(assertFailure(failedRequest, 503).code, "AUDIT_WRITE_FAILED");
      assert.equal(await ctx.db.reminderLog.count({ where: { shopId: tenant.shop.id, customerId: customer.id } }), 0);

      const reservationInput = {
        customerId: customer.id,
        channel: "whatsapp",
        template: null,
        templateText: "Namaste {{customerName}}, ₹{{balance}} pending hai. - {{shopName}}",
        overrideCooldown: false,
      };
      const reservations = await Promise.all([
        __remindersInternals.reserveReminderDecision(tenant.shop.id, { userId: tenant.owner.id, role: "owner" }, reservationInput),
        __remindersInternals.reserveReminderDecision(tenant.shop.id, { userId: tenant.owner.id, role: "owner" }, reservationInput),
      ]);
      assert.deepEqual(reservations.map((row) => row.code).sort(), [null, "REMINDER_COOLDOWN_ACTIVE"].sort());
      assert.equal(reservations.filter((row) => row.log.status === "queued").length, 1);
      assert.equal(reservations.filter((row) => row.log.error === "REMINDER_COOLDOWN_ACTIVE").length, 1);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "REMINDER_REQUESTED" } }), 1);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: tenant.shop.id, action: "REMINDER_SKIPPED_COOLDOWN" } }), 1);

      const log = await ctx.db.reminderLog.create({
        data: {
          shopId: tenant.shop.id,
          customerId: customer.id,
          message: "A durable reminder",
          status: "queued",
          provider: "disabled",
          requestedByUserId: tenant.owner.id,
        },
      });
      await assert.rejects(
        forceAuditFailure("REMINDER_DISPATCH_STARTED", () => claimReminderForDispatch(log.id)),
        (error) => error?.code === "AUDIT_WRITE_FAILED",
      );
      assert.equal((await ctx.db.reminderLog.findUniqueOrThrow({ where: { id: log.id } })).status, "queued");

      const firstClaim = await claimReminderForDispatch(log.id);
      assert.equal(firstClaim.claimed, true);
      assert.equal(firstClaim.log.status, "sending");
      const replayedClaim = await claimReminderForDispatch(log.id);
      assert.equal(replayedClaim.claimed, false);
      assert.equal(replayedClaim.log.status, "sending");
      assert.equal(await ctx.db.auditLog.count({ where: { entityId: log.id, action: "REMINDER_DISPATCH_STARTED" } }), 1);

      await assert.rejects(
        forceAuditFailure("REMINDER_ACCEPTED", () => markReminderFromProvider(log.id, {
          success: true,
          provider: "meta",
          providerMessageId: "wamid-atomic-reminder-proof",
        })),
        (error) => error?.code === "AUDIT_WRITE_FAILED",
      );
      const afterProviderAuditFailure = await ctx.db.reminderLog.findUniqueOrThrow({ where: { id: log.id } });
      assert.equal(afterProviderAuditFailure.status, "sending");
      assert.equal(afterProviderAuditFailure.providerMessageId, null);

      const accepted = await markReminderFromProvider(log.id, {
        success: true,
        provider: "meta",
        providerMessageId: "wamid-atomic-reminder-proof",
      });
      assert.equal(accepted.status, "accepted");
      assert.equal(accepted.providerMessageId, "wamid-atomic-reminder-proof");
    });

    test("enforces reminder plan, phone, balance and owner-only cooldown override gates", async () => {
      const starter = await createTenant(ctx.db, { planCode: "starter" });
      const starterAuth = await login(ctx, starter.ownerMobile, starter.ownerPassword);
      const starterCustomer = await createCustomer(ctx.db, starter.shop.id, { udharAmount: 500, mobile: "9876543210" });
      const unavailable = await ctx.post(
        "/api/reminders/send",
        { customerId: starterCustomer.id, channel: "whatsapp" },
        { token: starterAuth.accessToken },
      );
      assert.equal(assertFailure(unavailable, 403).code, "FEATURE_NOT_AVAILABLE");
      assert.equal(await ctx.db.reminderLog.count({ where: { shopId: starter.shop.id } }), 0);

      const pro = await createTenant(ctx.db, { planCode: "pro" });
      const ownerAuth = await login(ctx, pro.ownerMobile, pro.ownerPassword);
      const noPhone = await createCustomer(ctx.db, pro.shop.id, { udharAmount: 500, mobile: null });
      const missingPhone = await ctx.post(
        "/api/reminders/send",
        { customerId: noPhone.id, channel: "whatsapp" },
        { token: ownerAuth.accessToken },
      );
      assert.equal(assertFailure(missingPhone, 400).code, "CUSTOMER_PHONE_REQUIRED");

      const paidUp = await createCustomer(ctx.db, pro.shop.id, { udharAmount: 0, mobile: "9876543211" });
      const noBalance = assertSuccess(await ctx.post(
        "/api/reminders/send",
        { customerId: paidUp.id, channel: "whatsapp" },
        { token: ownerAuth.accessToken },
      ), 202);
      assert.equal(noBalance.code, "CUSTOMER_HAS_NO_PENDING_UDHAR");
      assert.equal(noBalance.queued, false);
      assert.equal(await ctx.db.auditLog.count({ where: { shopId: pro.shop.id, action: "REMINDER_SKIPPED_NO_BALANCE" } }), 1);

      const staff = await createStaff(ctx.db, pro.shop.id);
      const staffAuth = await login(ctx, staff.staffMobile, staff.staffPassword);
      const due = await createCustomer(ctx.db, pro.shop.id, { udharAmount: 500, mobile: "9876543212" });
      const forbiddenOverride = await ctx.post(
        "/api/reminders/send",
        { customerId: due.id, channel: "whatsapp", overrideCooldown: true },
        { token: staffAuth.accessToken },
      );
      assert.equal(assertFailure(forbiddenOverride, 403).code, "REMINDER_COOLDOWN_OVERRIDE_FORBIDDEN");
      assert.equal(await ctx.db.reminderLog.count({ where: { shopId: pro.shop.id, customerId: due.id } }), 0);
    });
  });
}
