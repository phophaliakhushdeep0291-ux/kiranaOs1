import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createReleaseSnapshot, releaseSourceInventory, releaseSnapshotDestination } from "../scripts/create-release-snapshot.js";

const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "kiranaos-source-snapshot-test-"));
const source = path.join(fixture, "source");
const run = (args) => {
  const result = spawnSync("git", args, { cwd: source, encoding: "utf8", shell: false });
  assert.equal(result.status, 0, result.stderr); return result.stdout;
};
try {
  fs.mkdirSync(source);
  fs.writeFileSync(path.join(source, ".gitignore"), ".env\nnode_modules/\ngenerated/\n/.release-qa/\n");
  fs.writeFileSync(path.join(source, "app.js"), "export const amount = 1;\n");
  fs.writeFileSync(path.join(source, "retired.js"), "old\n");
  run(["init"]); run(["add", "."]);
  run(["-c", "user.name=Snapshot test", "-c", "user.email=test@localhost", "-c", "commit.gpgsign=false", "commit", "-m", "fixture"]);
  fs.writeFileSync(path.join(source, "app.js"), "export const amount = 2;\n");
  fs.writeFileSync(path.join(source, "new-test.js"), "untracked current source\n");
  fs.writeFileSync(path.join(source, ".env"), "PRIVATE_VALUE=do-not-copy\n");
  fs.unlinkSync(path.join(source, "retired.js"));
  const before = releaseSourceInventory(source);
  const destination = releaseSnapshotDestination(source);
  assert.equal(path.dirname(destination), path.join(source, ".release-qa"));
  assert.match(path.basename(destination), /^[a-f0-9]{12}$/);
  assert.notEqual(releaseSnapshotDestination(source), destination);
  const report = createReleaseSnapshot({ sourceRoot: source, destination });
  assert.equal(report.status, "captured");
  assert.equal(report.sourceContentSha256, before.contentSha256);
  assert.equal(releaseSourceInventory(source).contentSha256, before.contentSha256, "nested snapshots must remain ignored and never enter later captures");
  assert.equal(fs.readFileSync(path.join(destination, "app.js"), "utf8"), "export const amount = 2;\n");
  assert.equal(fs.existsSync(path.join(destination, "new-test.js")), true);
  assert.equal(fs.existsSync(path.join(destination, ".env")), false);
  assert.equal(fs.existsSync(path.join(destination, "retired.js")), false);
  assert.equal(run(["rev-parse", "HEAD"]).trim(), before.commit, "capturing must not commit or mutate the source repository");
  assert.throws(() => createReleaseSnapshot({ sourceRoot: source, destination }), /already exists/);
  assert.throws(() => createReleaseSnapshot({ sourceRoot: source, destination: path.join(fixture, "racing"),
    afterCopy: () => fs.writeFileSync(path.join(source, "app.js"), "changed mid-capture\n") }), /Source changed/);
  run(["add", "--force", ".env"]);
  assert.throws(() => createReleaseSnapshot({ sourceRoot: source, destination: path.join(fixture, "private") }), /private configuration/);
  assert.equal(fs.existsSync(path.join(fixture, "private")), false);
  console.log("Release source snapshot tests passed: exact dirty source, untracked additions, deletions, secret exclusion, no overwrite, and concurrent-edit rejection");
} finally {
  const target = fs.realpathSync(fixture);
  const temp = fs.realpathSync(os.tmpdir());
  const relative = path.relative(temp, target);
  if (!relative.startsWith("kiranaos-source-snapshot-test-") || relative.includes(path.sep)) throw new Error("Unsafe fixture cleanup target");
  fs.rmSync(target, { recursive: true, force: true });
}
