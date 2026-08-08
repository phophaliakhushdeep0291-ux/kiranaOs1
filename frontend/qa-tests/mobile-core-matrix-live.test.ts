import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

describe("live mobile core matrix", () => {
  it("captures and validates every core route and viewport", async () => {
    const result = await execFileAsync(process.execPath, ["scripts/capture-mobile-core-matrix-v1.mjs"], {
      cwd: path.resolve("."),
      timeout: 220_000,
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024,
    });
    expect(result.stderr).toBe("");
    expect(result.stdout).toContain("Mobile core matrix passed 32/32 captures");
  }, 230_000);
});
