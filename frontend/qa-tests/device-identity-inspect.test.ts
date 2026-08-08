import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect device identity", () => {
  it("prints storage names", () => console.log(readFileSync("src/lib/device-identity.ts", "utf8")));
});
