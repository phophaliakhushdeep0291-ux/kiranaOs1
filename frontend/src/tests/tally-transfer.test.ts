import { describe, expect, it, vi } from "vitest";
import { confirmationBody, sendPreparedTallyTransfer, type TallyEnvelope, type PendingTallyTransfer } from "@/features/core/settings/tally-transfer";
const envelope: TallyEnvelope = { xml: "combined", mastersXml: "masters", vouchersXml: "vouchers", count: 2, masterCount: 1, skipped: 3, counts: { sales: 2 }, company: { guid: "guid1234", name: "Books", currencyCode: "INR" }, signature: "signed", documents: [1, 2].map((id) => ({ id: String(id), type: "sale", voucherNumber: `INV-${id}`, remoteId: `remote-${id}` })) };
const accepted = { ok: true, created: 2, altered: 0, errors: 0, exceptions: 0, ignored: 0 };
describe("Tally transfer recovery", () => {
  it("saves recovery before sending vouchers and only confirms exact acceptance", async () => {
    const sequence: string[] = [];
    await sendPreparedTallyTransfer(envelope, {
      post: async (xml) => { sequence.push(xml); return accepted; },
      save: async (pending) => { sequence.push(pending?.phase ?? "clear"); },
      confirm: async () => { sequence.push("confirm"); },
    });
    expect(sequence).toEqual(["masters", "sending", "vouchers", "accepted", "confirm", "clear"]);
  });
  it("retains accepted vouchers when the cloud acknowledgement fails, allowing confirmation-only recovery", async () => {
    let pending: PendingTallyTransfer | null = null;
    const post = vi.fn(async () => accepted);
    await expect(sendPreparedTallyTransfer(envelope, { post, save: async (p) => { pending = p; }, confirm: async () => { throw new Error("offline"); } })).rejects.toThrow("offline");
    expect(pending).toMatchObject({ phase: "accepted", documents: envelope.documents });
    expect(confirmationBody(pending!)).toEqual({ documents: envelope.documents, companyGuid: envelope.company.guid, signature: "signed" });
    expect(post).toHaveBeenCalledTimes(2);
  });
  it.each(["timeout", "partial", "ignored"])("never confirms or automatically retries an uncertain %s import", async (failure) => {
    let pending: PendingTallyTransfer | null = null;
    const confirm = vi.fn();
    const post = vi.fn(async (xml) => {
      if (xml === "masters") return accepted;
      if (failure === "timeout") throw new Error("timeout");
      return { ...accepted, created: failure === "partial" ? 1 : 2, ignored: failure === "ignored" ? 1 : 0 };
    });
    await expect(sendPreparedTallyTransfer(envelope, { post, save: async (p) => { pending = p; }, confirm })).rejects.toThrow();
    expect(pending).toMatchObject({ phase: "sending" }); expect(confirm).not.toHaveBeenCalled(); expect(post).toHaveBeenCalledTimes(2);
  });
  it("does not send vouchers if recovery storage cannot be written", async () => {
    const post = vi.fn(async () => accepted);
    await expect(sendPreparedTallyTransfer(envelope, { post, save: async () => { throw new Error("storage full"); }, confirm: vi.fn() })).rejects.toThrow("storage full");
    expect(post).toHaveBeenCalledTimes(1);
  });
});
