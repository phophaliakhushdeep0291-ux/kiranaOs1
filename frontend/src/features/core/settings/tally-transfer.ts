import type { TallyCompany, TallyPostResult } from "@/features/core/hardware/local-hardware-bridge";
export interface TallyDocument { type: string; id: string; voucherNumber: string; remoteId: string }
export interface TallyEnvelope {
  xml: string; mastersXml: string; vouchersXml: string; count: number; masterCount: number; skipped: number;
  documents: TallyDocument[]; counts: Record<string, number>; company: TallyCompany; signature: string | null;
}
export interface PendingTallyTransfer {
  company: TallyCompany; documents: TallyDocument[]; signature: string;
  phase: "sending" | "accepted"; result?: TallyPostResult;
}
export function confirmationBody(pending: PendingTallyTransfer) {
  return { documents: pending.documents, companyGuid: pending.company.guid, signature: pending.signature };
}
export async function sendPreparedTallyTransfer(envelope: TallyEnvelope, io: {
  post: (xml: string, company: TallyCompany) => Promise<TallyPostResult>;
  save: (pending: PendingTallyTransfer | null) => Promise<void>;
  confirm: (pending: PendingTallyTransfer) => Promise<void>;
}) {
  if (!envelope.signature || !envelope.company.guid || envelope.count !== envelope.documents.length) throw new Error("TALLY_TRANSFER_NOT_PREPARED");
  if (!envelope.count) return;
  if (envelope.masterCount) await io.post(envelope.mastersXml, envelope.company);
  // Persist BEFORE contacting Tally. A closed tab or lost reply must not lead
  // to a blind resend. This journal contains the exact signed confirmation.
  const pending: PendingTallyTransfer = { company: envelope.company, documents: envelope.documents, signature: envelope.signature, phase: "sending" };
  await io.save(pending);
  const result = await io.post(envelope.vouchersXml, envelope.company);
  if (!result.ok || result.errors || result.exceptions || result.ignored || result.created + result.altered !== envelope.count) throw new Error("TALLY_IMPORT_INCOMPLETE");
  const accepted = { ...pending, phase: "accepted" as const, result };
  await io.save(accepted);
  await io.confirm(accepted);
  await io.save(null);
}
