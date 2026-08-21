/**
 * Create a git worktree that this repo can actually build in.
 *
 *   node scripts/new-worktree.mjs pack-sizes
 *   node scripts/new-worktree.mjs pack-sizes --from origin/main --no-db
 *
 * Two Claude sessions sharing one checkout share one git index and one branch.
 * They collide: work gets committed under the other session's message, a branch
 * is merged while it is still being tested, `git checkout` moves the tree under a
 * running dev server. A worktree gives each session its own index, branch and
 * working files, which removes the whole class of problem.
 *
 * `git worktree add` alone is NOT enough here, because three things a worktree
 * needs are deliberately untracked:
 *
 *   backend/.env            gitignored, so the API has no DATABASE_URL and will
 *                           not boot
 *   node_modules            never present in a new worktree
 *   backend/prisma/dev.db   the local SQLite database
 *
 * The node_modules one is a trap worth stating plainly: do NOT junction or
 * symlink the main repo's node_modules into a worktree. `prisma generate` run
 * through such a link writes into the MAIN repo's client and corrupts it, which
 * then breaks the checkout you were trying to leave alone. Each worktree gets its
 * own real install; that is the cost of isolation and it is worth paying.
 */
import { execFileSync, execSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync } from "node:fs";
import path from "node:path";

const args = process.argv.slice(2);
const name = args.find((value) => !value.startsWith("--"));
const flag = (key) => args.includes(`--${key}`);
const option = (key, fallback) => {
  const at = args.indexOf(`--${key}`);
  return at >= 0 && args[at + 1] && !args[at + 1].startsWith("--") ? args[at + 1] : fallback;
};

if (!name) {
  console.error("usage: node scripts/new-worktree.mjs <name> [--from origin/main] [--no-install] [--no-db]");
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`"${name}" must be lowercase letters, digits and dashes — it becomes a branch and a folder.`);
  process.exit(1);
}

const repo = execSync("git rev-parse --show-toplevel", { encoding: "utf8" }).trim();
const target = path.join(repo, ".claude", "worktrees", name);
const branch = `work/${name}`;
const base = option("from", "origin/main");

if (existsSync(target)) {
  console.error(`${target} already exists. Pick another name, or remove it with:\n  git worktree remove ${target}`);
  process.exit(1);
}

const run = (command, cwd = repo) => execSync(command, { cwd, stdio: "inherit" });
const quiet = (command, cwd = repo) => execSync(command, { cwd, encoding: "utf8" }).trim();

console.log(`\nworktree: ${name}\n  branch: ${branch}\n    base: ${base}\n`);

// Base off the freshest server state, so a new worktree never starts behind.
try {
  run("git fetch origin --quiet");
} catch {
  console.log("  (offline — basing on the local ref instead)");
}

const baseRef = (() => {
  try {
    return quiet(`git rev-parse --verify ${base}`);
  } catch {
    console.log(`  ${base} not found, falling back to HEAD`);
    return quiet("git rev-parse HEAD");
  }
})();

mkdirSync(path.dirname(target), { recursive: true });
execFileSync("git", ["worktree", "add", "-b", branch, target, baseRef], { cwd: repo, stdio: "inherit" });

// ── the untracked files a worktree cannot inherit ───────────────────────────
for (const relative of ["backend/.env", "frontend/.env", "frontend/.env.local"]) {
  const from = path.join(repo, relative);
  if (!existsSync(from)) continue;
  mkdirSync(path.dirname(path.join(target, relative)), { recursive: true });
  copyFileSync(from, path.join(target, relative));
  console.log(`  copied ${relative}`);
}

// Its own database file, not the main one: a worktree that writes into the shared
// dev.db is only isolated until the moment it runs a migration.
if (!flag("no-db")) {
  const db = path.join(repo, "backend", "prisma", "dev.db");
  if (existsSync(db)) {
    copyFileSync(db, path.join(target, "backend", "prisma", "dev.db"));
    console.log("  copied backend/prisma/dev.db (its own copy)");
  }
}

// ── dependencies: real installs, never a link to the main repo's ────────────
if (!flag("no-install")) {
  for (const project of ["frontend", "backend"]) {
    console.log(`\n  installing ${project} …`);
    const at = path.join(target, project);
    const lock = path.join(at, "package-lock.json");
    // frontend is a pnpm project with no package-lock; backend is npm.
    if (project === "frontend" && !existsSync(lock)) {
      run("npx --yes pnpm install --frozen-lockfile", at);
    } else {
      run("npm ci", at);
    }
  }
}

console.log(`
done.

  cd ${target}

Notes for whoever works there:
  - This worktree has its own branch (${branch}), index and database. Committing,
    checking out and merging here cannot disturb the main checkout.
  - The backend's ALLOWED_ORIGINS only trusts 5173, 5174, 5500 and 51977, and the
    API does not reload .env, so pick a dev-server port from that list rather than
    editing the allowlist.
  - Before believing any UI observation, check which tree the port you are looking
    at is actually served from. A stale dev server from another worktree is the
    most expensive way to be wrong.
  - A session cannot remove its own worktree: git holds the directory open and the
    remove fails with "Permission denied" or "Device or resource busy". Tidy up
    from the MAIN checkout, from a shell whose working directory is not inside it:
      git worktree remove --force ${target}
      git branch -D ${branch}
    and if the folder survives that (Windows keeps handles for a while), delete it
    with PowerShell and then reconcile git's bookkeeping:
      Remove-Item -Recurse -Force ${target}
      git worktree prune
`);
