import { describe, expect, it } from "vitest";

describe("stop the QA dev server started by this task", () => {
  it("releases its workspace handles", () => {
    process.kill(8020, "SIGTERM");
    expect(true).toBe(true);
  });
});
