import crypto from "node:crypto";
import { mkdir, open, readFile, rename } from "node:fs/promises";
import path from "node:path";

// Unlike a print retry, a repeated accounting write can duplicate turnover.
// Keep accepted batches and uncertain starts across bridge restarts. Only hashes,
// company/voucher identities and import counters are stored, never voucher XML.
export class TallyTransferJournal {
  constructor(file) { this.file = file; this.rows = []; this.queue = Promise.resolve(); }
  async load() {
    try {
      const parsed = JSON.parse(await readFile(this.file, "utf8"));
      if (parsed.version !== 1 || !Array.isArray(parsed.rows) || parsed.rows.some((r) => !r.key || !r.company || !Array.isArray(r.ids) || !["sending", "accepted"].includes(r.phase))) throw new Error("Invalid Tally transfer journal");
      this.rows = parsed.rows;
    } catch (error) { if (error.code !== "ENOENT") throw error; }
  }
  async persist() {
    await mkdir(path.dirname(this.file), { recursive: true });
    const temp = `${this.file}.${process.pid}.tmp`;
    const handle = await open(temp, "w", 0o600);
    try { await handle.writeFile(JSON.stringify({ version: 1, rows: this.rows }), "utf8"); await handle.sync(); }
    finally { await handle.close(); }
    await rename(temp, this.file);
  }
  run(company, xml, send) {
    const operation = this.queue.catch(() => undefined).then(async () => {
      const ids = [...xml.matchAll(/<VOUCHER\s[^>]*REMOTEID="([^"]+)"/gi)].map((match) => match[1]);
      const count = (xml.match(/<VOUCHER\s/gi) ?? []).length;
      if (ids.length !== count || new Set(ids).size !== count) throw Object.assign(new Error("Every voucher needs a unique remote identity. Prepare the transfer again."), { status: 400 });
      const key = crypto.createHash("sha256").update(`${company}\n${xml}`).digest("hex");
      const previous = this.rows.find((row) => row.key === key);
      if (previous?.phase === "accepted") return previous.result;
      const requested = new Set(ids);
      const overlap = this.rows.some((row) => row.company === company && row.ids.some((id) => requested.has(id)));
      if (overlap) throw Object.assign(new Error("These vouchers were already sent or have an uncertain import. Check Tally and save the original transfer confirmation; do not resend them."), { status: 409 });
      if (this.rows.length >= 10000) throw Object.assign(new Error("Tally transfer history is full. Archive and reconcile it before sending more."), { status: 507 });
      const row = { key, company, ids, phase: "sending", createdAt: new Date().toISOString() };
      this.rows.push(row);
      await this.persist();
      const result = await send();
      if (!result.ok) return result; // Keep the uncertain start for reconciliation.
      row.phase = "accepted"; row.result = result;
      await this.persist();
      return result;
    });
    this.queue = operation;
    return operation;
  }
}
