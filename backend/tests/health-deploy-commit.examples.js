import assert from "node:assert/strict";

// "Is my fix actually deployed?" cost hours twice in one day, because the only
// signals available were uptimeSeconds and merge timestamps — both of which prove
// a restart happened, not which code restarted. /health now reports the commit the
// platform injected at deploy time, so the question has a definitive answer.
//
// This boots the real Express app and makes a real request rather than asserting
// on source text, because the failure mode that matters is the field being absent
// from the served response — which a source grep cannot see.

// Must be set before importing app.js: the deploy identity is resolved once at
// module load, not per request.
process.env.RAILWAY_GIT_COMMIT_SHA = "9f36d72abc1234567890deadbeef";
process.env.RAILWAY_GIT_BRANCH = "main";

const { default: app } = await import("../src/app.js");

/**
 * Release what the readiness probe opens, before this process is allowed to end.
 *
 * /health/ready calls getRedisClient() whenever QUEUES_ENABLED is set. That client
 * is built with lazyConnect and maxRetriesPerRequest: null, so once it CONNECTS it
 * holds the event loop open with a live socket and reconnect timers — and this
 * file, like its siblings, has no process.exit and relies on the loop draining.
 *
 * On a machine with no Redis the connection simply fails and the loop drains, which
 * is why this passed locally for the whole time it was broken. In CI, where the job
 * provisions Redis alongside PostgreSQL, it connects and the script never exits: the
 * release certification sat inside test:source-contracts until the 45-minute job
 * timeout killed it, on a suite that finishes in 16 minutes without this file.
 */
async function releaseOpenHandles() {
  try {
    const { closeRedis } = await import("../src/lib/redis.js");
    await closeRedis();
  } catch { /* no client was ever created */ }
  try {
    const { default: db } = await import("../src/db.js");
    await db.$disconnect();
  } catch { /* nothing to disconnect */ }
}

const server = app.listen(0);
await new Promise((resolve) => server.once("listening", resolve));
const { port } = server.address();

try {
  const body = await fetch(`http://127.0.0.1:${port}/health`).then((r) => r.json());

  assert.equal(body.commit, "9f36d72abc12", "health must report the deployed commit");
  assert.equal(body.branch, "main", "and which branch it was built from");
  assert.equal(
    body.commit.length,
    12,
    "short sha only — enough to match against git log without publishing a full build fingerprint",
  );
  // The fields that were already load-bearing must survive.
  assert.equal(body.status, "ok");
  assert.equal(typeof body.uptimeSeconds, "number");

  // /health is public (middleware/security.js exempts it), so this is reachable
  // without auth by design — that is the whole point of it being a one-curl check.
  const ready = await fetch(`http://127.0.0.1:${port}/health/ready`).then((r) => r.json());
  assert.equal(ready.commit, "9f36d72abc12", "readiness reports the same build");
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// ── absent platform vars must not break the endpoint ────────────────
// Local runs, `docker run`, and any platform that sets none of these still need a
// serving health check — an unknown build is not an error. The deploy identity is
// resolved once at module load, so proving this needs a fresh process.
const { execFileSync } = await import("node:child_process");
const probe = `
  const { default: app } = await import("./src/app.js");
  const server = app.listen(0);
  await new Promise((r) => server.once("listening", r));
  const body = await fetch("http://127.0.0.1:" + server.address().port + "/health").then((r) => r.json());
  console.log(JSON.stringify({ commit: body.commit, branch: body.branch, status: body.status }));
  await new Promise((r) => server.close(r));
`;

const cleanEnv = { ...process.env };
for (const key of ["RAILWAY_GIT_COMMIT_SHA", "RAILWAY_GIT_BRANCH", "VERCEL_GIT_COMMIT_SHA", "VERCEL_GIT_COMMIT_REF", "GIT_COMMIT_SHA", "SOURCE_VERSION"]) {
  delete cleanEnv[key];
}

const out = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
  env: cleanEnv,
  cwd: new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"),
  encoding: "utf8",
}).trim().split("\n").pop();

const bare = JSON.parse(out);
assert.equal(bare.commit, "unknown", "a missing commit reports 'unknown', not undefined or a crash");
assert.equal(bare.branch, undefined, "branch is omitted entirely rather than reported as a fake value");
assert.equal(bare.status, "ok", "the endpoint still serves without any platform vars");

await releaseOpenHandles();

console.log("health-deploy-commit.examples.js OK");
