import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect failing reports capture assertion", () => {
  it("prints the affected source", () => console.log(readFileSync("scripts/capture-reports-ui.mjs", "utf8").split("\n").slice(145, 205).join("\n")));
});
