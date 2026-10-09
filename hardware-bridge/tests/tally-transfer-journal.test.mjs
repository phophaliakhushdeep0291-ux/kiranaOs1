import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { TallyTransferJournal } from "../src/tally-transfer-journal.mjs";
const XML = '<VOUCHER REMOTEID="sale-1" />';
test("accepted Tally transfers survive restart and simultaneous retries", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tally-journal-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new TallyTransferJournal(path.join(dir, "history.json")); await journal.load();
  let calls = 0; const send = async () => { calls++; return { ok: true, created: 1 }; };
  await Promise.all([journal.run("company", XML, send), journal.run("company", XML, send)]);
  const restarted = new TallyTransferJournal(journal.file); await restarted.load();
  assert.deepEqual(await restarted.run("company", XML, send), { ok: true, created: 1 });
  assert.equal(calls, 1);
  await assert.rejects(() => restarted.run("company", XML + '<VOUCHER REMOTEID="sale-2" />', send), /already sent/);
});
test("an uncertain Tally write is never blindly retried after restart", async (t) => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "tally-journal-")); t.after(() => rm(dir, { recursive: true, force: true }));
  const journal = new TallyTransferJournal(path.join(dir, "history.json")); await journal.load();
  await assert.rejects(() => journal.run("company", XML, async () => { throw new Error("lost reply"); }), /lost reply/);
  const restarted = new TallyTransferJournal(journal.file); await restarted.load();
  await assert.rejects(() => restarted.run("company", XML, async () => assert.fail("must not send")), /uncertain import/);
});
