import assert from "node:assert/strict";
import fs from "node:fs";
import { test } from "node:test";

const { scripts } = JSON.parse(fs.readFileSync(new URL("../package.json", import.meta.url), "utf8"));

test("package scripts execute every listed test instead of passing tests as unused arguments", () => {
  for (const [name, command] of Object.entries(scripts)) {
    for (const invocation of command.split(/\s*(?:&&|\|\||;)\s*/)) {
      // Node executes one entry point unless its test runner is explicitly on.
      // Our DB runner intentionally accepts multiple files and runs each one.
      if (!/^node\s/.test(invocation) || /\s--test(?:\s|$)/.test(invocation)) continue;
      const files = invocation.match(/\btests\/[^\s]+\.js\b/g) || [];
      if (files.length < 2) continue;
      assert.match(invocation, /^node\s+scripts\/run-db-example-tests\.js\s/,
        `${name} silently skips tests: ${invocation}`);
    }
  }
});
