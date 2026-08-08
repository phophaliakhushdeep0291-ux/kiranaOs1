import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import { mkdtemp, rm } from "node:fs/promises";
import { PrintJobJournal } from "../src/job-journal.mjs";
import { PrintJobExecutor } from "../src/print-executor.mjs";

const PAYLOAD_FINGERPRINT = "a".repeat(64);

for (const failure of ["paper out mid-print", "cable disconnected", "network disconnected", "printer powered off"]) {
  test(`${failure} can retry the same id without reprinting a confirmed receipt`, async (context) => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-retry-test-"));
    context.after(() => rm(directory, { recursive: true, force: true }));
    const journal = new PrintJobJournal(path.join(directory, "jobs.json"));
    await journal.load();
    let attempts = 0;
    let accepted = 0;
    const executor = new PrintJobExecutor({
      journal,
      buildBuffer: () => Buffer.from("receipt"),
      sendRaw: async () => {
        attempts += 1;
        if (attempts === 1) throw new Error(failure);
        accepted += 1;
      },
    });
    const input = { jobId: `receipt:${failure.replaceAll(" ", "-")}`, copies: 1, payloadFingerprint: PAYLOAD_FINGERPRINT };
    await assert.rejects(() => executor.run(input));
    assert.equal(journal.get(input.jobId).completedCopies, 0);
    const recovered = await executor.run(input);
    assert.equal(recovered.completedCopies, 1);
    const duplicate = await executor.run(input);
    assert.equal(duplicate.duplicate, true);
    assert.equal(accepted, 1);
    assert.equal(attempts, 2);
  });
}

test("concurrent reuse of a job id for different receipt content is rejected", async (context) => {
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-payload-race-test-"));
  context.after(() => rm(directory, { recursive: true, force: true }));
  const journal = new PrintJobJournal(path.join(directory, "jobs.json"));
  await journal.load();
  let releaseSend;
  const sending = new Promise((resolve) => { releaseSend = resolve; });
  const executor = new PrintJobExecutor({
    journal,
    buildBuffer: () => Buffer.from("receipt"),
    sendRaw: () => sending,
  });
  const first = executor.run({ jobId: "receipt:payload-race", copies: 1, payloadFingerprint: "b".repeat(64) });
  await new Promise((resolve) => setImmediate(resolve));
  await assert.rejects(
    () => executor.run({ jobId: "receipt:payload-race", copies: 1, payloadFingerprint: "c".repeat(64) }),
    (error) => error.status === 409 && /different receipt payload/i.test(error.message),
  );
  releaseSend();
  await first;
});
