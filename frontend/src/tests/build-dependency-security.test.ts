import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { describe, expect, it } from "vitest";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const fromVite = createRequire(require.resolve("vite/package.json"));
const fromPostcss = createRequire(fromVite.resolve("postcss/package.json"));
const fromReactPlugin = createRequire(require.resolve("@vitejs/plugin-react"));
const fromBabel = createRequire(fromReactPlugin.resolve("@babel/core"));
const fromTargets = createRequire(fromBabel.resolve("@babel/helper-compilation-targets"));
const fromBrowserslist = createRequire(fromTargets.resolve("browserslist"));

function atLeast(version: string, minimum: string) {
  const actual = version.split(".").map(Number);
  const required = minimum.split(".").map(Number);
  expect(actual.every(Number.isInteger)).toBe(true);
  const differing = actual.findIndex((part, index) => part !== required[index]);
  expect(differing === -1 || actual[differing] > required[differing], `${version} must be >= ${minimum}`).toBe(true);
}

describe("patched build dependencies", () => {
  it("resolves the security-fixed toolchain through its actual consumers", () => {
    atLeast(require("vitest/package.json").version, "4.1.11");
    atLeast(sharp.versions.sharp, "0.35.4");
    atLeast(fromVite("postcss/package.json").version, "8.5.23");
    atLeast(fromPostcss("nanoid/package.json").version, "3.3.18");
    atLeast(fromTargets("browserslist/package.json").version, "4.28.7");
    const mappingMain = fromBrowserslist.resolve("baseline-browser-mapping");
    const mappingPackage = JSON.parse(fs.readFileSync(path.resolve(path.dirname(mappingMain), "../package.json"), "utf8"));
    atLeast(mappingPackage.version, "2.11.0");
  });

  it("does not disclose an out-of-tree source map when CSS has no source filename", async () => {
    const fixture = fs.mkdtempSync(path.join(os.tmpdir(), "kiranaos-css-security-"));
    try {
      const externalMap = path.join(fixture, "external.map");
      fs.writeFileSync(externalMap, JSON.stringify({ version: 3, sources: ["synthetic-external.css"],
        sourcesContent: ["SYNTHETIC_MAP_CONTENT_NOT_TO_DISCLOSE"], mappings: "AAAA", names: [] }));
      const result = await fromVite("postcss")([]).process(`a{color:red}\n/*# sourceMappingURL=${externalMap.replaceAll("\\", "/")} */`, {
        from: undefined, map: { inline: false },
      });
      expect(JSON.stringify(result.map?.toJSON())).not.toContain("SYNTHETIC_MAP_CONTENT_NOT_TO_DISCLOSE");
      expect(result.css).toContain("color:red");
    } finally {
      const target = fs.realpathSync(fixture);
      const relative = path.relative(fs.realpathSync(os.tmpdir()), target);
      if (!relative.startsWith("kiranaos-css-security-") || relative.includes(path.sep)) throw new Error("Unsafe fixture cleanup target");
      fs.rmSync(target, { recursive: true, force: true });
    }
  });

  it("preserves normal CSS processing and unique generated IDs", async () => {
    const result = await fromVite("postcss")([]).process(".counter { color: #123456; }", { from: undefined, map: false });
    expect(result.css).toContain("#123456");
    const nanoid = fromPostcss("nanoid").nanoid;
    const ids = Array.from({ length: 100 }, () => nanoid());
    expect(new Set(ids).size).toBe(100);
    expect(ids.every((id) => typeof id === "string" && id.length === 21)).toBe(true);
  });

  it("keeps native image processing functional with the patched binary", async () => {
    const png = await sharp({ create: { width: 4, height: 4, channels: 3, background: "#123456" } }).png().toBuffer();
    const { data, info } = await sharp(png).resize(2, 2).raw().toBuffer({ resolveWithObject: true });
    expect(info).toMatchObject({ width: 2, height: 2, channels: 3 });
    expect(Array.from(data.subarray(0, 3))).toEqual([18, 52, 86]);
  });
});
