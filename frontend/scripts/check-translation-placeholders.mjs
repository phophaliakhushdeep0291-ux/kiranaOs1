import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
// Moved under features/core when the tree split into core/ and verticals/. The
// old path made this guard exit with ENOENT instead of checking anything, so
// every placeholder mismatch below went unnoticed while the gate looked "red for
// an unrelated reason".
const translationsDir = join(scriptDir, "..", "src", "features", "core", "settings", "translations");

// The `Record<keyof typeof xEn, string>` signature on each Hindi module already
// makes a MISSING key a typecheck failure. What it cannot see is the inside of
// the strings: a Hindi value that writes {amount} where English writes {count}
// compiles cleanly and then renders a literal "{amount}" to the shopkeeper,
// because interpolate() only substitutes names the caller actually passed.
// Same for a value left as an empty string — typed fine, blank on screen.
//
// These modules are flat maps of string literals, so they are read as text
// rather than imported: the checker then runs on any supported Node without
// depending on TypeScript type-stripping being available.
const ENTRY_RE = /"([^"]+)"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
const PLACEHOLDER_RE = /\{(\w+)\}/g;

function parseEntries(source) {
  return new Map([...source.matchAll(ENTRY_RE)].map((match) => [match[1], match[2]]));
}

function placeholders(value) {
  return [...new Set([...value.matchAll(PLACEHOLDER_RE)].map((match) => match[1]))].sort();
}

async function main() {
  const files = await readdir(translationsDir);
  const englishModules = files
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".hi.ts"))
    .map((name) => name.replace(/\.ts$/, ""))
    // hindi.ts and its hindi-*.ts halves are the loaders that stitch the
    // per-module Hindi tables together, not catalogues of their own — they hold
    // no English strings, so there is nothing here to compare and no
    // `<name>.hi.ts` counterpart to demand.
    //
    // Matched by prefix rather than by name so splitting the Hindi load again
    // (it is already split into a critical and a deferred half, so that the
    // first paint does not block on the whole dictionary) does not fail this
    // gate with a complaint about a missing `hindi-something.hi.ts`. Nothing
    // English can collide with the prefix.
    //
    // The ENGLISH aggregators need the same exemption, and did not get it when
    // the English catalogue was split the same way. `english.ts`,
    // `english-critical.ts` and `english-deferred.ts` re-export the per-module
    // tables; they hold no strings of their own and there is no
    // `english-critical.hi.ts` for them to be compared against. Without this the
    // gate reported three missing counterparts that were never meant to exist.
    .filter((name) => !["hindi", "english"].includes(name) && !name.startsWith("hindi-") && !name.startsWith("english-"))
    .sort();

  const problems = [];
  let comparedTotal = 0;

  for (const moduleName of englishModules) {
    const hindiFile = `${moduleName}.hi.ts`;
    if (!files.includes(hindiFile)) {
      problems.push(`${moduleName}: no ${hindiFile} — every English catalogue needs a Hindi counterpart`);
      continue;
    }

    const english = parseEntries(await readFile(join(translationsDir, `${moduleName}.ts`), "utf8"));
    const hindi = parseEntries(await readFile(join(translationsDir, hindiFile), "utf8"));

    let compared = 0;
    let mismatched = 0;

    for (const [key, englishValue] of english) {
      if (!hindi.has(key)) {
        problems.push(`${moduleName}: "${key}" missing from ${hindiFile}`);
        continue;
      }
      compared += 1;

      const hindiValue = hindi.get(key);
      if (hindiValue.trim() === "") {
        problems.push(`${moduleName}: "${key}" is empty in ${hindiFile}`);
        mismatched += 1;
        continue;
      }

      const want = placeholders(englishValue);
      const got = placeholders(hindiValue);
      if (want.join(",") !== got.join(",")) {
        problems.push(
          `${moduleName}: "${key}" placeholders differ — en {${want.join(", ")}} vs hi {${got.join(", ")}}`,
        );
        mismatched += 1;
      }
    }

    for (const key of hindi.keys()) {
      if (!english.has(key)) {
        problems.push(`${moduleName}: "${key}" exists in ${hindiFile} but not in the English catalogue`);
      }
    }

    comparedTotal += compared;
    const note = english.size === 0 ? " (empty catalogue — not yet translated)" : "";
    console.log(`${moduleName}: ${compared} key(s) compared, ${mismatched} problem(s)${note}`);
  }

  console.log(`Translations: ${comparedTotal} key(s) compared across ${englishModules.length} module(s)`);

  if (problems.length > 0) {
    for (const problem of problems) console.error(`  ${problem}`);
    throw new Error(`${problems.length} translation problem(s) found.`);
  }
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
