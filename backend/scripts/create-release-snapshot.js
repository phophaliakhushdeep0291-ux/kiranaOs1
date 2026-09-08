import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

function git(root, args, input) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8", shell: false, input, maxBuffer: 32 * 1024 * 1024 });
  if (result.status !== 0) throw new Error(`Snapshot Git step failed: ${args[0]}`);
  return result.stdout;
}
const digest = (bytes) => crypto.createHash("sha256").update(bytes).digest("hex");
function inside(root, relative) {
  const resolved = path.resolve(root, relative);
  const suffix = path.relative(root, resolved);
  if (!suffix || suffix === ".." || suffix.startsWith(`..${path.sep}`) || path.isAbsolute(suffix)) throw new Error("Snapshot path escapes its root");
  return resolved;
}

export function releaseSourceInventory(sourceRoot) {
  const root = fs.realpathSync(sourceRoot);
  const commit = git(root, ["rev-parse", "HEAD"]).trim();
  const paths = [...new Set(git(root, ["ls-files", "--cached", "--others", "--exclude-standard", "-z"]).split("\0").filter(Boolean))].sort();
  const files = [];
  for (const relative of paths) {
    if (relative.split(/[\\/]/).some((part) => part === ".git" || part === "node_modules" || (/^\.env(?:\.|$)/.test(part) && part !== ".env.example"))) {
      throw new Error("Source inventory contains private configuration or dependency artifacts");
    }
    const absolute = inside(root, relative);
    let stat;
    try { stat = fs.lstatSync(absolute); } catch (error) { if (error.code === "ENOENT") continue; throw error; }
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error("Release snapshot requires regular repository files, not links or submodules");
    // A parent junction must not redirect a listed file outside the source.
    inside(root, path.relative(root, fs.realpathSync(absolute)));
    files.push({ path: relative, bytes: stat.size, sha256: digest(fs.readFileSync(absolute)) });
  }
  if (!files.length) throw new Error("Release snapshot source is empty");
  return { commit, files, contentSha256: digest(JSON.stringify(files)) };
}

export function createReleaseSnapshot({ sourceRoot, destination, afterCopy = () => {} }) {
  const source = fs.realpathSync(sourceRoot);
  const target = path.resolve(destination);
  if (fs.existsSync(target)) throw new Error("Snapshot destination already exists; existing files are never overwritten");
  const before = releaseSourceInventory(source);
  fs.mkdirSync(target, { recursive: true });
  for (const entry of before.files) {
    const output = inside(target, entry.path);
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.copyFileSync(inside(source, entry.path), output, fs.constants.COPYFILE_EXCL);
    if (digest(fs.readFileSync(output)) !== entry.sha256) throw new Error(`Source changed while copying ${entry.path}; snapshot is not valid`);
  }
  afterCopy();
  const after = releaseSourceInventory(source);
  if (before.commit !== after.commit || before.contentSha256 !== after.contentSha256) {
    const oldFiles = new Map(before.files.map((entry) => [entry.path, entry.sha256]));
    const newFiles = new Map(after.files.map((entry) => [entry.path, entry.sha256]));
    const changed = [...new Set([...oldFiles.keys(), ...newFiles.keys()])].filter((name) => oldFiles.get(name) !== newFiles.get(name));
    throw new Error(`Source changed while the snapshot was captured; snapshot is not valid (${before.commit !== after.commit ? "commit changed; " : ""}${changed.slice(0, 10).join(", ")})`);
  }
  const metadata = {
    schemaVersion: 1, type: "kiranaos_release_source_snapshot", status: "captured",
    capturedAt: new Date().toISOString(), sourceCommit: before.commit, sourceContentSha256: before.contentSha256,
    files: before.files,
    limitations: ["This identifies captured source, not test success. Install dependencies and run the full certification inside this directory.",
      "Later source edits require a new snapshot and new certification; ignored local secrets, databases and dependencies are not copied."],
  };
  const metadataName = ".kiranaos-release-snapshot.json";
  fs.writeFileSync(path.join(target, metadataName), `${JSON.stringify(metadata, null, 2)}\n`, { flag: "wx" });
  git(target, ["init", "-b", "codex/release-proof-snapshot"]);
  git(target, ["add", "--force", "--pathspec-from-file=-", "--pathspec-file-nul"], [...before.files.map((entry) => entry.path), metadataName].join("\0") + "\0");
  git(target, ["-c", "user.name=KiranaOS verification", "-c", "user.email=verification@localhost", "-c", "commit.gpgsign=false", "commit", "-m", "Capture source for isolated release verification"]);
  return { type: metadata.type, status: "captured", destination: target, sourceCommit: before.commit,
    sourceContentSha256: before.contentSha256, snapshotCommit: git(target, ["rev-parse", "HEAD"]).trim(), fileCount: before.files.length };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const sourceRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
  const destination = path.join(sourceRoot, "backend", "release-artifacts", "source-snapshots", crypto.randomUUID());
  try { console.log(JSON.stringify(createReleaseSnapshot({ sourceRoot, destination }), null, 2)); }
  catch (error) { console.error(JSON.stringify({ type: "kiranaos_release_source_snapshot", status: "failed", destination, message: error.message })); process.exitCode = 1; }
}
