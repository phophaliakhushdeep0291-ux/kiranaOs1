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
  const payloadFingerprint = "a".repeat(64);
  const first = new PrintJobJournal(filePath);
  await first.load();
  await first.begin("receipt:test:0001", 2, payloadFingerprint);
  await first.recordCopy("receipt:test:0001");

  const restarted = new PrintJobJournal(filePath);
  await restarted.load();
  assert.deepEqual(restarted.get("receipt:test:0001"), { requestedCopies: 2, completedCopies: 1, payloadFingerprint, updatedAt: restarted.get("receipt:test:0001").updatedAt });
  await assert.rejects(() => restarted.begin("receipt:test:0001", 1, payloadFingerprint), (error) => error.status === 409);
  await assert.rejects(
    () => restarted.begin("receipt:test:0001", 2, "b".repeat(64)),
    (error) => error.status === 409 && /different receipt payload/i.test(error.message),
  );
  await restarted.recordCopy("receipt:test:0001");

  const completed = new PrintJobJournal(filePath);
  await completed.load();
  assert.equal(completed.get("receipt:test:0001").completedCopies, 2);
});

test("legacy rows without a payload fingerprint fail closed and malformed copy progress is clamped", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-legacy-journal-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, "jobs.json");
  await import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, JSON.stringify({
    version: 1,
    jobs: [{ jobId: "receipt:legacy:0001", requestedCopies: 99, completedCopies: 99, updatedAt: 1 }],
  })));
  const journal = new PrintJobJournal(filePath);
  await journal.load();
  assert.equal(journal.get("receipt:legacy:0001").requestedCopies, 5);
  assert.equal(journal.get("receipt:legacy:0001").completedCopies, 5);
  await assert.rejects(
    () => journal.begin("receipt:legacy:0001", 5, "c".repeat(64)),
    (error) => error.status === 409 && /predates payload verification/i.test(error.message),
  );
});
