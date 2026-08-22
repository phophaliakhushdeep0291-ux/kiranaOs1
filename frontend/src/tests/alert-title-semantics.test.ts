import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const alertSource = readFileSync("src/components/ui/alert.tsx", "utf8");

describe("alert title semantics", () => {
  it("does not inject a fixed h5 into arbitrary page heading hierarchies", () => {
    expect(alertSource).toContain("const AlertTitle");
    expect(alertSource).toContain("HTMLDivElement");
    expect(alertSource).not.toContain("<h5");
  });
});
