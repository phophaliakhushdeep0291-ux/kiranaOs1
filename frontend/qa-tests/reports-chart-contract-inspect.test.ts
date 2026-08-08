import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

describe("inspect report KPI chart contract", () => {
  it("prints chart-related report lines", () => {
    const source = readFileSync("src/features/core/reports/pages/ReportsPage.tsx", "utf8");
    console.log(source.split("\n").filter((line) => /Spark|Area|Chart|fill=|gradient/i.test(line)).slice(0, 180).join("\n"));
  });
});
