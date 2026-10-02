import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("../src", import.meta.url)) } },
  test: {
    include: ["scripts/local-report-benchmark.bench.ts"],
    environment: "node",
    maxWorkers: 1,
    testTimeout: 120_000,
  },
});
