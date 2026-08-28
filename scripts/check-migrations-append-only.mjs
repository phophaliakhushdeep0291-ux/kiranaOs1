#!/usr/bin/env node
/**
 * A migration that has already run is history, not source.
 *
 * Prisma records each migration by name and never runs it twice, so editing an
 * applied migration is silent: the file looks right in review, the deploy goes
 * green, and the database is untouched. We shipped exactly that — a backfill
 * corrected in place, a successful deploy, and a store room that did not change
 * — and only found it by reading the migration history against the diff.
 *
 * A correction belongs in a NEW migration. This refuses a pull request that
 * deletes, renames, or alters a migration that already exists on the base
 * branch, which is the closest thing the repository can check to "already
 * applied somewhere".
 *
 * The rule is "identical to the content it was first committed with" rather
 * than "unchanged since the base branch", because those differ in the one case
 * that matters: repairing a migration that was already edited in place on the
 * base branch. Restoring it to its original text IS the fix, so it has to pass.
 */
import { spawnSync } from "node:child_process";
import process from "node:process";

const MIGRATION_DIRS = ["backend/prisma/migrations", "backend/prisma-postgres/migrations"];

const git = (...args) => spawnSync("git", args, { encoding: "utf8" });
const skip = (why) => { console.log(`check-migrations-append-only: ${why}; skipping.`); process.exit(0); };

const base = [process.env.GITHUB_BASE_REF && `origin/${process.env.GITHUB_BASE_REF}`, "origin/main", "main"]
  .find((ref) => ref && git("rev-parse", "--verify", "--quiet", ref).status === 0);
if (!base) skip("no base branch to compare against");

const merge = git("merge-base", base, "HEAD");
if (merge.status !== 0) skip("no common ancestor with the base branch");

const diff = git("diff", "--diff-filter=MDR", "--name-status", `${merge.stdout.trim()}..HEAD`, "--", ...MIGRATION_DIRS);
if (diff.status !== 0) {
  console.error("check-migrations-append-only: git diff failed.");
  console.error(diff.stderr);
  process.exit(1);
}

function originalContent(file) {
  const added = git("log", "--diff-filter=A", "--format=%H", "-1", "--", file);
  const sha = added.stdout.trim();
  if (!sha) return null;
  const blob = git("show", `${sha}:${file}`);
  return blob.status === 0 ? blob.stdout : null;
}

const offenders = [];
for (const line of diff.stdout.split("\n").map((l) => l.trim()).filter(Boolean)) {
  const [status, ...paths] = line.split(/\s+/);
  if (status.startsWith("D")) { offenders.push(["deleted", paths.join(" -> ")]); continue; }
  if (status.startsWith("R")) { offenders.push(["renamed", paths.join(" -> ")]); continue; }
  const file = paths[0];
  const original = originalContent(file);
  const current = git("show", `HEAD:${file}`);
  if (original === null || current.status !== 0 || current.stdout !== original) {
    offenders.push(["modified", file]);
  }
}

if (offenders.length === 0) {
  console.log("check-migrations-append-only: migrations match the content they shipped with.");
  process.exit(0);
}

console.error("A migration that already exists on the base branch was changed:");
console.error("");
for (const [verb, file] of offenders) console.error(`  ${verb.padEnd(9)} ${file}`);
console.error(`
Prisma records a migration by name and never runs it twice, so this edit will
not reach any database that has already applied it. The deploy will succeed and
change nothing.

Restore the file to the content it was first committed with, and add a NEW
migration carrying the correction, written so that replaying it is harmless.`);
process.exit(1);
