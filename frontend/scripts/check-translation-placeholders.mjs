import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const translationsDir = join(scriptDir, "..", "src", "features", "settings", "translations");

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
    // hindi.ts is the loader that stitches the per-module Hindi tables together,
    // not a catalogue of its own.
    .filter((name) => name !== "hindi")
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
