import os from "node:os";
import path from "node:path";
import { mkdir, open, readFile, rename } from "node:fs/promises";

const VERSION = 1;

export function defaultJournalPath() {
  return process.env.KIRANA_BRIDGE_JOB_JOURNAL
    ? path.resolve(process.env.KIRANA_BRIDGE_JOB_JOURNAL)
    : path.join(os.homedir(), ".kiranaos", "hardware-bridge-print-jobs.json");
}

export class PrintJobJournal {
  constructor(filePath = defaultJournalPath(), { maxJobs = 500 } = {}) {
    this.filePath = filePath;
    this.maxJobs = maxJobs;
    this.jobs = new Map();
    this.writeQueue = Promise.resolve();
  }

  async load() {
    let raw;
    try { raw = await readFile(this.filePath, "utf8"); }
    catch (error) {
      if (error?.code === "ENOENT") return;
      throw error;
    }
    let parsed;
    try { parsed = JSON.parse(raw); }
    catch { throw new Error(`Print job journal is invalid JSON: ${this.filePath}`); }
    if (parsed?.version !== VERSION || !Array.isArray(parsed.jobs)) throw new Error(`Print job journal has an unsupported format: ${this.filePath}`);
    for (const row of parsed.jobs) {
      if (!row || typeof row.jobId !== "string" || !Number.isInteger(row.requestedCopies) || !Number.isInteger(row.completedCopies)) continue;
      this.jobs.set(row.jobId, {
        requestedCopies: Math.min(5, Math.max(1, row.requestedCopies)),
        completedCopies: Math.min(row.requestedCopies, Math.max(0, row.completedCopies)),
        updatedAt: Number(row.updatedAt) || Date.now(),
      });
    }
    this.prune();
  }

  get(jobId) {
    const row = this.jobs.get(jobId);
    return row ? { ...row } : null;
  }

  async begin(jobId, requestedCopies) {
    const existing = this.jobs.get(jobId);
    if (existing) {
      if (existing.requestedCopies !== requestedCopies) throw Object.assign(new Error("Print job id was already used with a different copy count"), { status: 409 });
      return { ...existing };
    }
    this.jobs.set(jobId, { requestedCopies, completedCopies: 0, updatedAt: Date.now() });
    try { this.prune(); }
    catch (error) { this.jobs.delete(jobId); throw error; }
    await this.persist();
    return this.get(jobId);
  }

  async recordCopy(jobId) {
    const row = this.jobs.get(jobId);
    if (!row) throw new Error("Print job was not started");
    row.completedCopies = Math.min(row.requestedCopies, row.completedCopies + 1);
    row.updatedAt = Date.now();
    await this.persist();
    return { ...row };
  }

  prune() {
    if (this.jobs.size <= this.maxJobs) return;
    const completed = [...this.jobs.entries()]
      .filter(([, row]) => row.completedCopies >= row.requestedCopies)
      .sort((a, b) => a[1].updatedAt - b[1].updatedAt);
    while (this.jobs.size > this.maxJobs && completed.length) this.jobs.delete(completed.shift()[0]);
    if (this.jobs.size > this.maxJobs) throw Object.assign(new Error("Too many unfinished print jobs; resolve the printer before accepting more"), { status: 507 });
  }

  persist() {
    this.writeQueue = this.writeQueue.catch(() => undefined).then(async () => {
      const directory = path.dirname(this.filePath);
      await mkdir(directory, { recursive: true });
      const temporary = `${this.filePath}.${process.pid}.tmp`;
      const payload = JSON.stringify({
        version: VERSION,
        jobs: [...this.jobs.entries()].map(([jobId, row]) => ({ jobId, ...row })),
      });
      const handle = await open(temporary, "w", 0o600);
      try {
        await handle.writeFile(payload, "utf8");
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(temporary, this.filePath);
    });
    return this.writeQueue;
  }
}
