/**
 * The owner PIN must not outlive the op it authorised.
 *
 * It gates every catalogue and stock change, and it travels in the outbox payload
 * because an op queued offline still needs it whenever the push finally happens. But it
 * was never cleared afterwards: reading `sync_outbox` on a real shop's device showed the
 * PIN in the clear, as a plain 4-digit string, on an op whose status was already SYNCED —
 * one copy for every gated action that shop had ever performed.
 *
 * The scrub runs on SYNCED only. A FAILED op is retried from this very payload, so
 * stripping it there would push an unauthorised op; a CONFLICT may still be re-pushed by
 * resolution. Both of those matter more than the marginal exposure of an op that has not
 * finished, which is why the timing is asserted here and not just commented.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { withoutOwnerSecrets } from "@/lib/offline/db";

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
    expect(dbSource).toContain('dexieDB.sync_outbox.where("status").equals("SYNCED")');
  });
});
