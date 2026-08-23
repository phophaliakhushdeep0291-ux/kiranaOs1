import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  IMAGE_BUDGET_BYTES,
  IMAGE_DIMENSIONS,
  encodingLadder,
  scaledSize,
  withinBudget,
} from "@/features/core/products/pages/product-image-encoding";

/**
 * A product image is stored as a base64 data URL inside `product.imageUrl`, so
 * it is paid for in the database column, every device's IndexedDB, every sync
 * payload, and every catalogue re-download. The old path capped the FILE at 2 MB
 * and encoded at a fixed 512px/q=0.72, which bounds nothing: measured on that
 * pipeline a clean packshot cost ~9 kB and a phone photo of a shelf ~158 kB.
 */
describe("product image encoding", () => {
  it("keeps a picture's shape while fitting the box", () => {
    // Landscape, portrait and square must all keep their aspect ratio — a
    // stretched product photo looks broken on the billing tile.
    expect(scaledSize(1024, 512, 512)).toEqual({ width: 512, height: 256 });
    expect(scaledSize(512, 1024, 512)).toEqual({ width: 256, height: 512 });
    expect(scaledSize(1000, 1000, 320)).toEqual({ width: 320, height: 320 });
  });

  it("never enlarges a picture that is already small", () => {
    // Upscaling a 64px logo to 512px buys bytes and no detail whatsoever.
    expect(scaledSize(64, 48, 512)).toEqual({ width: 64, height: 48 });
    expect(scaledSize(200, 100, 512)).toEqual({ width: 200, height: 100 });
  });

  it("never produces a zero-sided canvas", () => {
    // A canvas with a zero dimension throws on drawImage, which would surface as
    // "image read failed" on a perfectly good file.
    for (const [w, h] of [[0, 0], [1, 10_000], [10_000, 1], [Number.NaN, 10]]) {
      const size = scaledSize(w, h, 512);
      expect(size.width).toBeGreaterThanOrEqual(1);
      expect(size.height).toBeGreaterThanOrEqual(1);
    }
  });

  it("steps dimension before quality, and ends at the smallest rung", () => {
    const ladder = encodingLadder();
    // Losing pixels hurts a thumbnail less than JPEG/WebP mush does, so the
    // outer loop must be dimension.
    expect(ladder[0]).toEqual({ maxDimension: 512, quality: 0.72 });
    expect(ladder[1].maxDimension).toBe(512);
    expect(ladder[1].quality).toBeLessThan(0.72);

    const last = ladder[ladder.length - 1];
    expect(last.maxDimension).toBe(Math.min(...IMAGE_DIMENSIONS));
    // Monotonic: every rung is no larger and no higher-quality than the one before.
    for (let i = 1; i < ladder.length; i += 1) {
      expect(ladder[i].maxDimension).toBeLessThanOrEqual(ladder[i - 1].maxDimension);
    }
  });

  it("bounds the encoded string, not the source file", () => {
    expect(withinBudget("x".repeat(IMAGE_BUDGET_BYTES))).toBe(true);
    expect(withinBudget("x".repeat(IMAGE_BUDGET_BYTES + 1))).toBe(false);
    // A 560-item starter catalogue has to stay in sane territory.
    expect((IMAGE_BUDGET_BYTES * 560) / (1024 * 1024)).toBeLessThan(15);
  });

  it("prefers WebP but proves it before trusting it", () => {
    const source = readFileSync("src/features/core/products/pages/product-image-encoding.ts", "utf8");
    // A canvas without WebP support does not throw — it silently returns a PNG,
    // which would be BIGGER than the JPEG it replaced. The prefix check is the
    // whole safety of this optimisation.
    expect(source).toContain("probe.toDataURL(WEBP_MIME).startsWith(WEBP_DATA_URL_PREFIX) ? WEBP_MIME : JPEG_MIME");
  });

  it("encodes down the ladder instead of encoding once", () => {
    const panel = readFileSync("src/features/core/products/pages/components/ProductFormPanel.tsx", "utf8");
    expect(panel).toContain("for (const { maxDimension, quality } of encodingLadder())");
    expect(panel).toContain("if (withinBudget(lastEncoded, budgetBytes)) return lastEncoded;");
    // The old fixed encode must be gone, or the budget means nothing.
    expect(panel).not.toContain('canvas.toDataURL("image/jpeg", 0.72)');
  });
});
