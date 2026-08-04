import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { VERTICAL_PACKS } from "@/features/verticals/registry";

/**
 * The client declares each trade's capabilities locally so the POS can answer
 * "does this shop sell loose?" on first paint and while offline. The backend
 * derives the same list from the same business type, so the two must agree —
 * and since they are separate files, only a test keeps them that way.
 */

const BACKEND_VERTICALS = join(process.cwd(), "..", "backend", "src", "verticals");

/** Reads the string literals out of a backend `capabilities.js`. */
function backendCapabilities(dir: string): string[] {
  const source = readFileSync(join(BACKEND_VERTICALS, dir, "capabilities.js"), "utf8");
  const body = source.slice(source.indexOf("["), source.indexOf("]") + 1);
  return [...body.matchAll(/"([A-Z_]+)"/g)].map((match) => match[1]);
}

describe("vertical capabilities", () => {
  it("matches the backend list for every trade", () => {
    for (const pack of VERTICAL_PACKS) {
      // Pack folder and backend folder are named the same on purpose.
      const backend = backendCapabilities(pack.id);
      expect([...pack.capabilities].sort(), `${pack.id} capabilities drifted from the backend`)
        .toEqual([...backend].sort());
    }
  });

  it("gives every trade something to sell with", () => {
    for (const pack of VERTICAL_PACKS) {
      expect(pack.capabilities, `${pack.id} has no capabilities`).not.toHaveLength(0);
      expect(pack.capabilities).toContain("BASIC_INVENTORY");
    }
  });

  it("keeps loose selling and pack conversion off the trades that do not do it", () => {
    const withLoose = VERTICAL_PACKS.filter((pack) => pack.capabilities.includes("LOOSE_ITEMS")).map((p) => p.id);
    const withPacks = VERTICAL_PACKS.filter((pack) => pack.capabilities.includes("PACK_CONVERSION")).map((p) => p.id);

    // A clothing shop does not weigh out a shirt. This is the regression that
    // put "loose item" and kg/gram/ml on the clothing product form.
    expect(withLoose.sort()).toEqual(["kirana", "stationery-books"]);
    expect(withPacks).toEqual(["kirana"]);
  });
});
