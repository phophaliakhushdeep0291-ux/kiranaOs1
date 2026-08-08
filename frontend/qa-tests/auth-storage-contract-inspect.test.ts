import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect auth storage implementation", () => {
  it("prints the storage schema", () => console.log(readFileSync("src/lib/storage/auth-storage.ts", "utf8")));
});
