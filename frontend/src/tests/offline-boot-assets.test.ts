import { describe, expect, it } from "vitest";
import { assertOfflineBootAssets } from "../../scripts/offline-boot-assets.mjs";

function build() {
  const manifest = Object.fromEntries([
    "index.html", "src/components/layout/index.ts",
    "src/features/core/settings/translations/english-deferred.ts",
    "src/features/core/settings/translations/hindi-critical.ts",
    "src/features/core/settings/translations/hindi-deferred.ts",
  ].map((key, index) => [key, { file: `assets/entry-${index}.js`, imports: ["vendor"], css: ["assets/theme.css"] }]));
  manifest.vendor = { file: "assets/vendor.js", imports: [], css: [] };
  return { manifest, assets: [...Object.values(manifest).map((row) => `/${row.file}`), "/assets/theme.css"] };
}

describe("emitted offline boot assets", () => {
  it("accepts shared dependencies without double-counting them", () => {
    const { manifest, assets } = build();
    expect(assertOfflineBootAssets(manifest, assets)).toBe(6);
  });

  it.each(["entry-1.js", "entry-2.js", "entry-3.js", "entry-4.js", "vendor.js", "theme.css"])("rejects a ready marker that omits %s", (file) => {
    const { manifest, assets } = build();
    expect(() => assertOfflineBootAssets(manifest, assets.filter((asset) => asset !== `/assets/${file}`))).toThrow(file);
  });

  it("fails when a required dynamic import disappears from the emitted manifest", () => {
    const { manifest, assets } = build();
    delete manifest["src/components/layout/index.ts"];
    expect(() => assertOfflineBootAssets(manifest, assets)).toThrow("missing from build manifest");
  });
});
