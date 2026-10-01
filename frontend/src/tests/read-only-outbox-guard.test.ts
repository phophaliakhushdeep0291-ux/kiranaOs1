import { describe, expect, it, vi } from "vitest";

/**
 * Every outbox row passes through one check. The UI reports success on the
 * local write, so a view-only login that could queue a change would be told it
 * was saved and learn otherwise only when the server refused it later.
 */
const session = vi.hoisted(() => ({ user: undefined as { role?: string } | undefined }));
vi.mock("@/lib/storage/auth-storage", () => ({ loadAuthSession: () => ({ user: session.user }) }));
import { ReadOnlyRoleError, assertOutboxWriteAllowed } from "@/lib/offline/db";

describe("queueing a change from a view-only login", () => {
  it("is refused for anything the server would be sent", () => {
    session.user = { role: "viewer" };
    for (const operation_type of ["CREATE_BILL", "CREATE_CUSTOMER", "RECORD_PAYMENT", "STOCK_PURCHASE", "UPDATE_PRODUCT"]) {
      expect(() => assertOutboxWriteAllowed({ operation_type, type: operation_type }), operation_type).toThrow(ReadOnlyRoleError);
    }
    let caught: unknown;
    try {
      assertOutboxWriteAllowed({ operation_type: "CREATE_BILL", type: "CREATE_BILL" });
    } catch (error) {
      caught = error;
    }
    expect((caught as ReadOnlyRoleError | undefined)?.code).toBe("ROLE_READ_ONLY");
  });

  it("still records what stays on this device, which signing in itself does", () => {
    session.user = { role: "viewer" };
    for (const operation_type of ["AUDIT_LOG_APPEND", "UPDATE_SETTINGS", "SUBSCRIPTION_REFRESH"]) {
      expect(() => assertOutboxWriteAllowed({ operation_type, type: operation_type }), operation_type).not.toThrow();
    }
  });

  it("does not touch any other role, or a device with no session yet", () => {
    for (const user of [{ role: "owner" }, { role: "admin" }, { role: "staff" }, {}, undefined]) {
      session.user = user;
      expect(() => assertOutboxWriteAllowed({ operation_type: "CREATE_BILL", type: "CREATE_BILL" }), JSON.stringify(user)).not.toThrow();
    }
  });
});
