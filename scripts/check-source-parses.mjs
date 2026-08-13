// Fast pre-merge guard for the two ways a commit has reached production unable
// to run at all:
//
//   1. Merge conflict markers committed into a source file. `e9ef8ab` left
//      "<<<<<<< HEAD" inside paymentProvider.service.js, so the module could not
//      be parsed and the backend could not boot on Railway.
//   2. A syntax error in shipped JavaScript. The same afternoon a malformed
//      ternary in access.ts failed the Vite build on Vercel.
//
// Both are decidable in seconds with no dependencies installed, which is the
// whole point: the release certification is thorough but takes tens of minutes,
// and merges here land within minutes of the branch push, so only a check that
// finishes almost immediately can actually gate one. Deep verification stays in
// KiranaOS Release Certification; this file only answers "does the source
// parse".
//
// TypeScript is covered for markers here and for syntax by the frontend
// typecheck/build job, since parsing TS would need node_modules and that is the
// cost this check exists to avoid.

import { execFile, execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { availableParallelism } from "node:os";
import { resolve } from "node:path";

const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8" }).trim();

const tracked = execFileSync("git", ["ls-files", "-z"], { encoding: "utf8", maxBuffer: 20 * 1024 * 1024 })
  .split("\0")
  .filter(Boolean)
  .filter((file) => existsSync(resolve(repositoryRoot, file)));

// Binary payloads cannot carry a conflict marker git would have written as text,
// and reading them wastes the time this check is trying to save.
const BINARY = /\.(png|jpe?g|gif|webp|avif|ico|icns|bmp|svgz|woff2?|ttf|otf|eot|zip|gz|tgz|bz2|7z|rar|pdf|mp[34]|wav|ogg|webm|mov|avi|db|sqlite3?|wasm|exe|dll|so|dylib|jar|class|bin|dat|pfx|p12)$/i;

// Written as quantifiers so this file does not itself contain a line that looks
// like a conflict marker. Matching only the delimiters that cannot appear alone
// keeps documentation safe: a bare "=======" is a legitimate heading rule in
// Markdown, but a conflict always brings a start and an end line with it.
const MARKERS = [
  { pattern: /^<{7}[ \t]/, label: "conflict start" },
  { pattern: /^\|{7}[ \t]/, label: "diff3 common ancestor" },
  { pattern: /^>{7}[ \t]/, label: "conflict end" },
];

const markerViolations = [];

await Promise.all(tracked
  .filter((file) => !BINARY.test(file))
  .map(async (file) => {
    let contents;
    try {
      contents = await readFile(resolve(repositoryRoot, file), "utf8");
    } catch {
      return; // Unreadable or genuinely binary; the parse pass below still covers JS.
    }
    if (!contents.includes("<<<<<<<") && !contents.includes(">>>>>>>") && !contents.includes("|||||||")) return;
    contents.split("\n").forEach((line, index) => {
      for (const { pattern, label } of MARKERS) {
        if (pattern.test(line)) markerViolations.push(`${file}:${index + 1} (${label})`);
      }
    });
  }));

// node --check reads package.json "type" to decide script vs module, so ESM
// under backend/ and frontend/ is parsed as ESM without any flag here.
//
// There is no package.json at the repository root, so a root-level script must
// keep the .mjs extension (as scripts/ already does). A root-level .js file
// using import/export would be parsed as CommonJS and reported here as
// "Cannot use import statement outside a module" — rename it rather than
// loosening this check, which would hide the same error inside backend/.
const scripts = tracked.filter((file) => /\.(js|mjs|cjs)$/i.test(file));

const parseFailures = [];
let cursor = 0;

async function parseWorker() {
  while (cursor < scripts.length) {
    const file = scripts[cursor++];
    await new Promise((done) => {
      execFile(process.execPath, ["--check", resolve(repositoryRoot, file)], (error, _stdout, stderr) => {
        if (error) {
          // First stderr line that is not the echoed path is the actual reason.
          const reason = String(stderr).split("\n").map((line) => line.trim())
            .find((line) => /^(SyntaxError|Error)\b/.test(line)) ?? "failed to parse";
          parseFailures.push(`${file}: ${reason}`);
        }
        done();
      });
    });
  }
}

await Promise.all(Array.from({ length: Math.min(availableParallelism(), 16) }, parseWorker));

if (markerViolations.length) {
  console.error("Source parse check failed. Unresolved merge conflict markers are committed:");
  for (const violation of markerViolations.sort()) console.error(`- ${violation}`);
}

if (parseFailures.length) {
  console.error("Source parse check failed. These JavaScript files do not parse:");
  for (const failure of parseFailures.sort()) console.error(`- ${failure}`);
}

if (markerViolations.length || parseFailures.length) process.exit(1);

console.log(`Source parse check passed (${tracked.length} tracked files scanned for conflict markers; ${scripts.length} JavaScript files parsed).`);
