import crypto from "node:crypto";

export function fingerprintPrintPayload({ html, paperSize, autoCut, cashDrawer }) {
  const canonical = JSON.stringify([String(html), String(paperSize), Boolean(autoCut), Boolean(cashDrawer)]);
  return crypto.createHash("sha256").update(canonical).digest("hex");
}

export class PrintJobExecutor {
  constructor({ journal, sendRaw, buildBuffer }) {
    this.journal = journal;
    this.sendRaw = sendRaw;
    this.buildBuffer = buildBuffer;
    this.inFlight = new Map();
  }

  async run(input) {
    const { jobId, copies, payloadFingerprint } = input;
    const active = this.inFlight.get(jobId);
    if (active) {
      if (active.copies !== copies) throw Object.assign(new Error("Print job id is already active with a different copy count"), { status: 409 });
      if (active.payloadFingerprint !== payloadFingerprint) throw Object.assign(new Error("Print job id is already active for a different receipt payload"), { status: 409 });
      await active.promise;
      return { completedCopies: copies, duplicate: true, resumed: false };
    }
    const promise = (async () => {
      const existing = await this.journal.begin(jobId, copies, payloadFingerprint);
      if (existing.completedCopies >= copies) return { completedCopies: copies, duplicate: true, resumed: false };
      let completedCopies = existing.completedCopies;
      while (completedCopies < copies) {
        await this.sendRaw(this.buildBuffer(input, completedCopies));
        const progress = await this.journal.recordCopy(jobId);
        completedCopies = progress.completedCopies;
      }
      return { completedCopies, duplicate: false, resumed: existing.completedCopies > 0 };
    })();
    this.inFlight.set(jobId, { copies, payloadFingerprint, promise });
    try { return await promise; }
    finally { this.inFlight.delete(jobId); }
  }
}
