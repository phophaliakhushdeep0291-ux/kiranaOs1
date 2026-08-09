#!/usr/bin/env node
// Builds the production image for the release certification's image proof.
//
// `docker build .` on its own repeats the apt install, the full npm ci and
// prisma generate on every CI run, because no layer survives between jobs —
// the most expensive single step in the certification. When
// DOCKER_BUILD_CACHE_DIR is set and buildx is present, layers are read from and
// written to that directory, which the workflow persists with actions/cache.
//
// Every missing piece degrades instead of failing: no cache directory, or no
// buildx, and this runs exactly the `docker build .` it always did. A developer
// running `npm run docker:build` locally therefore sees no change at all.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const cacheDir = process.env.DOCKER_BUILD_CACHE_DIR || "";

function docker(args) {
  return spawnSync("docker", args, { stdio: "inherit" });
}

function finish(result) {
  process.exit(result.status === 0 && !result.error ? 0 : result.status || 1);
}

function plainBuild(reason) {
  if (reason) console.log(`${reason}; running an uncached build.`);
  finish(docker(["build", "."]));
}

// `--cache-to type=local` is refused outright by the default `docker` driver
// ("Cache export is not supported for the docker driver"). That aborts the
// build before a single layer is read, so the certification would report a
// failed image proof for a reason that has nothing to do with the image. Only
// a builder that can export a cache is asked to.
function cacheExportSupported() {
  const inspect = spawnSync("docker", ["buildx", "inspect"], { encoding: "utf8" });
  if (inspect.status !== 0) return false;
  const driver = /^\s*Driver:\s*(\S+)/im.exec(inspect.stdout || "")?.[1];
  return Boolean(driver) && driver !== "docker";
}

if (!cacheDir) plainBuild("");
if (spawnSync("docker", ["buildx", "version"], { encoding: "utf8" }).status !== 0) {
  plainBuild("docker buildx is unavailable");
}
if (!cacheExportSupported()) {
  plainBuild("the active buildx builder cannot export a layer cache");
}

// buildx's local exporter rewrites the whole directory each time and grows
// without bound, so write to a sibling and swap only once the build succeeded.
// A failed build must leave the previous cache untouched.
const current = path.resolve(cacheDir);
const staged = `${current}-new`;
fs.mkdirSync(current, { recursive: true });
fs.rmSync(staged, { recursive: true, force: true });

const args = ["buildx", "build", "--cache-to", `type=local,dest=${staged},mode=max`];
if (fs.readdirSync(current).length > 0) {
  args.push("--cache-from", `type=local,src=${current}`);
}
args.push(".");

const result = docker(args);
if (result.status !== 0 || result.error) {
  fs.rmSync(staged, { recursive: true, force: true });
  finish(result);
}

// The exporter only writes `staged` when it has something to record; if it did
// not, keep what we already had rather than deleting the cache.
if (fs.existsSync(staged)) {
  fs.rmSync(current, { recursive: true, force: true });
  fs.renameSync(staged, current);
  console.log(`Docker layer cache written to ${current}`);
}
process.exit(0);
