/**
 * The owner PIN must not outlive the op it authorised.
 *
 * It gates every catalogue and stock change, and it travels in the outbox payload
 * because an op queued offline still needs it whenever the push finally happens. But it
 * was never cleared afterwards: reading `sync_outbox` on a real shop's device showed the
 * PIN in the clear, as a plain 4-digit string, on an op whose status was already SYNCED —
 * one copy for every gated action that shop had ever performed.
 *
 * The immediate scrub runs on SYNCED only. A FAILED op is retried from this very payload,
 * so stripping it there would push an unauthorised op. A recent CONFLICT may still be
 * repaired and re-pushed; after a bounded retention window, keeping an abandoned repair
 * credential is the larger risk. That timing is asserted here, not merely commented.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { isStaleConflict, withoutOwnerSecrets } from "@/lib/offline/db";

const dbSource = readFileSync(fileURLToPath(new URL("../lib/offline/db.ts", import.meta.url)), "utf8");

describe("owner secrets are stripped from settled outbox payloads", () => {
  it("removes the PIN and leaves the rest of the op intact", () => {
    const scrubbed = withoutOwnerSecrets({
      localProductId: "product_1",
      product: { name: "Ashirvaad Atta", sellingPrice: 55 },
      reason: "Price revision",
      ownerPin: "2468",
      ownerPinProvided: true,
    });

    expect(scrubbed).toEqual({
      localProductId: "product_1",
      product: { name: "Ashirvaad Atta", sellingPrice: 55 },
      reason: "Price revision",
      // Kept on purpose: the audit trail records THAT an owner approved, never the PIN.
      ownerPinProvided: true,
    });
  });

  it("reaches secrets nested inside the entity the payload carries", () => {
    const scrubbed = withoutOwnerSecrets({
      supplier: { name: "Shree Balaji", ownerPin: "2468" },
      lines: [{ qty: 2, password: "hunter2" }, { qty: 3 }],
    });

    expect(scrubbed).toEqual({
      supplier: { name: "Shree Balaji" },
      lines: [{ qty: 2 }, { qty: 3 }],
    });
  });

  it("strips every credential spelling, not just ownerPin", () => {
    expect(withoutOwnerSecrets({ ownerPassword: "x", pin: "1111", keep: 1 })).toEqual({ keep: 1 });
  });

  it("reports 'nothing to do' rather than rewriting an untouched payload", () => {
    // The boot sweep walks every settled row; returning null is what stops it writing
    // the whole outbox back to disk on a device that is already clean.
    expect(withoutOwnerSecrets({ localProductId: "product_1", reason: "note" })).toBeNull();
    expect(withoutOwnerSecrets("just a string")).toBeNull();
    expect(withoutOwnerSecrets(undefined)).toBeNull();
  });

  it("scrubs only once the op is SYNCED, so a retry still carries its authorisation", () => {
    // Structural: the Dexie path cannot run here (no fake-indexeddb), and getting this
    // condition wrong pushes ops the server will refuse rather than anything visible.
    expect(dbSource).toContain('status === "SYNCED" ? withoutOwnerSecrets(row.payload) : null');
  });

  it("sweeps historical rows, because a settled op is never written again", () => {
    expect(dbSource).toContain("async scrubSettledOutboxSecrets()");
    expect(dbSource).toContain('.anyOf(["SYNCED", "CONFLICT"])');
  });
});

/**
 * A CONFLICT is not finished the way a SYNCED op is.
 *
 * `sync-status-repair` rescues some conflicts by putting the event back to PENDING, and
 * it rebuilds the push from THIS stored payload — so clearing the PIN the moment a
 * conflict appears would re-send a bill cancellation carrying no owner approval. Of the
 * repairable kinds only the bill lifecycle ones (CANCEL_BILL / RESTORE_BILL /
 * SOFT_DELETE_BILL) carry a PIN at all, but the sweep waits on time rather than on that
 * list: the list lives in the sync feature, which imports this module, so a copy here
 * would rot the day repair learned a new trick.
 */
describe("a conflict keeps its credentials only while a repair could still use them", () => {
  const DAY = 24 * 60 * 60 * 1000;
  const now = Date.parse("2026-08-22T12:00:00.000Z");
  const cutoff = now - 7 * DAY;

  it("keeps them on a conflict raised today, which repair may still rescue", () => {
    expect(isStaleConflict({ last_attempt_at: new Date(now - DAY).toISOString() } as never, cutoff)).toBe(false);
  });

  it("clears them once no repair will ever collect the row", () => {
    expect(isStaleConflict({ last_attempt_at: new Date(now - 30 * DAY).toISOString() } as never, cutoff)).toBe(true);
  });

  it("falls back through the timestamps a row might actually carry", () => {
    expect(isStaleConflict({ client_created_at: new Date(now - 30 * DAY).toISOString() } as never, cutoff)).toBe(true);
    expect(isStaleConflict({ createdAt: new Date(now - 30 * DAY).toISOString() } as never, cutoff)).toBe(true);
    expect(isStaleConflict({ client_created_at: new Date(now).toISOString() } as never, cutoff)).toBe(false);
  });

  it("treats an unreadable or missing timestamp as old", () => {
    // Undatable rows cannot be shown to be inside the window, and holding a credential
    // on that basis is the worse bet of the two.
    expect(isStaleConflict({} as never, cutoff)).toBe(true);
    expect(isStaleConflict({ last_attempt_at: "not a date" } as never, cutoff)).toBe(true);
  });
});
