import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/**
 * Two schemas, two clients, two places to put them.
 *
 * `prisma/schema.prisma` is SQLite and is what a developer runs against.
 * `prisma-postgres/schema.prisma` is PostgreSQL and is what production runs
 * against. Both declared a generator with no `output`, so both wrote to the same
 * default `@prisma/client`, and whichever ran last won.
 *
 * That is not a tidiness complaint. Running `npm run prisma:generate:postgres`
 * on a developer machine replaced the SQLite client the dev server needs, and
 * `npm run dev` then died at boot with "the URL must start with the protocol
 * postgresql://" — an error naming the datasource rather than the artifact that
 * had been overwritten. The same collision put a PostgreSQL client under
 * `@prisma/client` in CI, where the suite queries through the SQLite one.
 *
 * The fix is one line of schema and one branch in db.js. These are the checks
 * that keep them from drifting back together.
 */

// A file:// URL, not a path: on Windows a bare C:... is not an importable specifier.
const DB_MODULE = new URL("../src/db.js", import.meta.url).href;
const BACKEND_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The `output` of a schema's `client` generator, or null when it takes the default. */
function clientGeneratorOutput(schemaPath) {
  const source = readFileSync(fileURLToPath(new URL(schemaPath, import.meta.url)), "utf8");
  const block = source.slice(source.indexOf("generator client {"));
  const body = block.slice(0, block.indexOf("}"));
  const output = /output\s*=\s*"([^"]+)"/.exec(body);
  return output ? output[1] : null;
}

/**
 * Which client a datasource actually resolves to, in a real process.
 *
 * Prisma does not connect on import, so this needs no database — only the
 * generated clients, which CI builds before the suite runs.
 */
function clientLoadedFor(databaseUrl) {
  const probe = [
    'const { createRequire } = await import("node:module");',
    "const require = createRequire(process.env.PROBE_DB);",
    "await import(process.env.PROBE_DB);",
    "const loaded = Object.keys(require.cache);",
    "console.log(JSON.stringify({",
    '  postgres: loaded.some((key) => key.includes("postgres-prisma-client")),',
    '  fixedDefault: loaded.some((key) => key.includes("node_modules") && key.includes(".prisma")),',
    "}));",
  ].join("\n");

  const stdout = execFileSync(process.execPath, ["--input-type=module", "-e", probe], {
    cwd: BACKEND_ROOT,
    encoding: "utf8",
    env: { ...process.env, PROBE_DB: DB_MODULE, DATABASE_URL: databaseUrl, PRISMA_CLIENT_VARIANT: "" },
  });
  return JSON.parse(stdout.trim().split("\n").pop());
}

test("the two schemas cannot generate over each other", () => {
  const sqlite = clientGeneratorOutput("../prisma/schema.prisma");
  const postgres = clientGeneratorOutput("../prisma-postgres/schema.prisma");

  // The SQLite one keeps the default location: it is what @prisma/client means
  // on a developer machine, and every import of that name expects it.
  assert.equal(sqlite, null, "the SQLite client stays at the default @prisma/client location");
  assert.ok(postgres, "the PostgreSQL client needs an output of its own, or it overwrites the SQLite one");
  assert.notEqual(postgres, sqlite);
  assert.match(postgres, /generated\/postgres-prisma-client$/);
});

test("a PostgreSQL url loads the PostgreSQL client and nothing else", () => {
  const loaded = clientLoadedFor("postgresql://user:pass@127.0.0.1:5432/probe");
  assert.equal(loaded.postgres, true, "a PostgreSQL datasource must use the client built from the PostgreSQL schema");
  assert.equal(loaded.fixedDefault, false, "and must not fall through to the SQLite client at the fixed path");
});

test("a file url still loads the default client", () => {
  // The change must be invisible to everyone working locally.
  //
  // Not dev.db: db.js refuses to hand a test process the shared development
  // database, and that guard is worth keeping exercised rather than dodged.
  // Nothing connects here, so the file is never created.
  const loaded = clientLoadedFor("file:./prisma/client-selection-probe.db");
  assert.equal(loaded.fixedDefault, true);
  assert.equal(loaded.postgres, false);
});

test("db.js is the only place that names the fixed client path", () => {
  // The fixed path is now one of three clients. Anything reaching for it
  // directly can end up describing or querying a different schema from the
  // running server — which is how a restore was refused for a model the server
  // could see perfectly well.
  const files = execFileSync("git", ["ls-files", "src", "scripts", "tests"], { cwd: BACKEND_ROOT, encoding: "utf8" })
    .split("\n")
    .filter((name) => name.endsWith(".js") && name !== "src/db.js");

  const strays = files.filter((name) => /["(]@prisma\/client["')]/.test(readFileSync(`${BACKEND_ROOT}${name}`, "utf8")));
  assert.deepEqual(strays, [], `these must take their client from db.js: ${strays.join(", ")}`);
});

test("the generated PostgreSQL client is not committed", () => {
  const ignored = readFileSync(fileURLToPath(new URL("../.gitignore", import.meta.url)), "utf8");
  assert.match(ignored, /generated\/postgres-prisma-client/);
});
