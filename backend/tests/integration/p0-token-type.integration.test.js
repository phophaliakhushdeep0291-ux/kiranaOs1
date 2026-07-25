/**
 * Regression test for P0-2 in docs/STABILIZATION_AUDIT.md.
 *
 * The device-limit replacement challenge token is signed with the same JWT_SECRET
 * as a real access token and carries userId + shopId, but no tokenType and no
 * sessionId. requireAuth previously only rejected a token whose tokenType was
 * present AND wrong, so this token authenticated — bypassing every session,
 * device and revocation check, using a token handed out in a REJECTED login.
 *
 * These tests reproduce the exploit against the real HTTP surface and a real
 * database, and fail against the unfixed middleware.
 */
import test, { after, beforeEach, describe } from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { createIntegrationContext, resetDatabase, assertFailure, assertSuccess } from "./setup.js";
import { createTenant, login } from "./factories.js";

const ctx = await createIntegrationContext();

if (ctx.skip) {
  test("p0 token-type tests skipped", { skip: ctx.reason }, () => {});
} else {
  after(async () => ctx.close());
  beforeEach(async () => resetDatabase(ctx.db));

  describe("P0-2 — non-ACCESS tokens must never authenticate", () => {
    // devices.service.js issues this shape when a login is REJECTED for exceeding
    // the device cap. It is signed with JWT_SECRET and carries userId + shopId but
    // deliberately no sessionId, so none of the session/device/revocation checks in
    // requireAuth apply to it. It must not be usable as a bearer token.
    function signChallengeToken(user, extra = {}) {
      return jwt.sign(
        {
          purpose: "device_limit_replacement",
          challengeId: "challenge-test",
          userId: user.id,
          shopId: user.shopId,
          ...extra,
        },
        process.env.JWT_SECRET,
        { expiresIn: "5m" },
      );
    }

    test("a device-limit challenge token is rejected by an authenticated route", async () => {
      const tenant = await createTenant(ctx.db);
      const token = signChallengeToken(tenant.owner);

      const response = await ctx.get("/api/auth/me", { token });

      assertFailure(response, 401);
      assert.equal(response.body?.code, "INVALID_TOKEN_TYPE");
    });

    test("a token carrying no tokenType and no sessionId cannot reach shop data", async () => {
      const tenant = await createTenant(ctx.db);
      const token = signChallengeToken(tenant.owner);

      // A session-less token must not be able to enumerate devices, which is one of
      // the routes that does not carry requireDeviceActivated().
      const response = await ctx.get("/api/devices", { token });
      assertFailure(response, 401);
    });

    test("a legitimate ACCESS token still works", async () => {
      const tenant = await createTenant(ctx.db);
      const session = await login(ctx, tenant.ownerMobile, tenant.ownerPassword);

      const response = await ctx.get("/api/auth/me", { token: session.accessToken });
      const data = assertSuccess(response, 200);
      assert.equal(data.user.id, tenant.owner.id);
    });
  });
}
