import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { PrintJobJournal } from "../src/job-journal.mjs";

test("print progress survives restart and rejects changed copy counts", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-journal-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "jobs.json");
  const first = new PrintJobJournal(filePath);
  await first.load();
  await first.begin("receipt:test:0001", 2);
  await first.recordCopy("receipt:test:0001");

  const restarted = new PrintJobJournal(filePath);
  await restarted.load();
  assert.deepEqual(restarted.get("receipt:test:0001"), { requestedCopies: 2, completedCopies: 1, updatedAt: restarted.get("receipt:test:0001").updatedAt });
  await assert.rejects(() => restarted.begin("receipt:test:0001", 1), (error) => error.status === 409);
  await restarted.recordCopy("receipt:test:0001");

  const completed = new PrintJobJournal(filePath);
  await completed.load();
  assert.equal(completed.get("receipt:test:0001").completedCopies, 2);
});
