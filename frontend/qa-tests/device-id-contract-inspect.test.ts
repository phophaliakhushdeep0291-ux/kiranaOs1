import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect device id contract", () => {
  it("prints likely device storage keys", () => {
    for (const file of ["src/lib/device-id.ts", "src/lib/api/http.ts"]) {
      try { const source = readFileSync(file, "utf8"); console.log(file, source.split("\n").filter((line) => /device.*id|storage/i.test(line)).slice(0, 100).join("\n")); } catch { /* alternate location */ }
    }
  });
});
