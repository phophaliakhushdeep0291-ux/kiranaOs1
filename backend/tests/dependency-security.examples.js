import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const lock = JSON.parse(fs.readFileSync(new URL("../package-lock.json", import.meta.url), "utf8"));
const parserEntries = Object.entries(lock.packages).filter(([name]) => name.endsWith("node_modules/qs"));
assert.ok(parserEntries.length, "lockfile must identify the actual query parser");
function assertPatched(version, source) {
  const [major, minor] = String(version).split(".").map(Number);
  assert.ok(major > 6 || (major === 6 && minor >= 16), `${source} must resolve qs >= 6.16.0`);
}
for (const [name, entry] of parserEntries) assertPatched(entry.version, name);

// Exercise each consumer's actual resolved package, including nested copies.
// These bounded regressions cover GHSA-x5fp-wj9c-mxmx and GHSA-4mjr-xmp4-gh2g.
for (const consumer of ["express", "body-parser"]) {
  const fromConsumer = createRequire(require.resolve(`${consumer}/package.json`));
  const qs = fromConsumer("qs");
  assertPatched(fromConsumer("qs/package.json").version, consumer);
  assert.throws(() => qs.parse("items[]=1,2,3,4", { comma: true, arrayLimit: 3, throwOnLimitExceeded: true }), RangeError);
  const hostileConstructor = qs.parse("item[constructor][isBuffer]=not-callable", { plainObjects: true });
  assert.doesNotThrow(() => qs.stringify(hostileConstructor));
  assert.deepEqual(qs.parse("page=2&filter[status]=paid&ids[]=one&ids[]=two"), {
    page: "2", filter: { status: "paid" }, ids: ["one", "two"],
  });
  const resolved = path.relative(path.resolve("node_modules"), fromConsumer.resolve("qs"));
  assert.ok(resolved && !path.isAbsolute(resolved), "installed parser must be inspectable");
}
console.log("Dependency security regressions passed: patched query parsers, enforced array limits, safe constructor handling, ordinary query compatibility");
