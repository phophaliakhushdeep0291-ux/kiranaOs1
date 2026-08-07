/**
 * Turn catalog/kirana-starter-catalog.csv into a typed, committed TypeScript module.
 *
 * The catalog is shipped as code, not as a file read at runtime: a bundled module is
 * code-split by the same build as everything else, works offline with no fetch, and
 * cannot be half-downloaded on shop wifi. The CSV stays the editable source of truth
 * (catalog/build_catalog.py writes it, catalog/verify_catalog.py checks it).
 *
 * Run: npm run catalog:generate    (from frontend/)
 * The generated file is committed; src/tests/starter-catalog.test.ts fails if it is
 * stale relative to the CSV.
 */
import { createHash } from "node:crypto";
import { readFileSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = join(scriptDir, "..");
const repoRoot = join(frontendRoot, "..");
const csvPath = join(repoRoot, "catalog", "kirana-starter-catalog.csv");
const importContractPath = join(frontendRoot, "src", "features", "core", "products", "import", "product-import-csv.ts");
const outputDir = join(frontendRoot, "src", "features", "core", "products", "starter-catalog");
const outputPath = join(outputDir, "kirana-catalog.generated.ts");
const summaryPath = join(outputDir, "kirana-catalog-summary.generated.ts");

/**
 * Line endings and the BOM are not content. git normalises them per platform
 * (core.autocrlf), so a checksum over raw bytes would make the staleness test fail on
 * a clean clone rather than on a real edit. The app's own parser normalises the same
 * two things before reading a row, so this loses nothing the importer would have seen.
 */
export function normaliseCatalogCsv(text) {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

export function checksumCatalogCsv(text) {
  return createHash("sha256").update(normaliseCatalogCsv(text), "utf8").digest("hex");
}

/** RFC-4180, matching parseCsv() in product-import-csv.ts including both throws. */
function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const source = normaliseCatalogCsv(text);

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (inQuotes) {
      if (character === '"') {
        if (source[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          inQuotes = false;
        }
      } else {
        field += character;
      }
    } else if (character === '"') {
      if (field.length > 0) throw new Error("A quoted value starts after unquoted text.");
      inQuotes = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (inQuotes) throw new Error("The CSV contains an unclosed quoted value.");
  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter((cells) => cells.some((cell) => cell.trim() !== ""));
}

/**
 * Read the column contract out of the importer instead of restating it here. If someone
 * renames or reorders a column, generation fails loudly rather than writing a module
 * whose fields are quietly one place to the left.
 */
function readImportColumns() {
  const source = readFileSync(importContractPath, "utf8");
  const block = source.match(/export const PRODUCT_IMPORT_COLUMNS: ImportColumn\[] = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error(`Could not find PRODUCT_IMPORT_COLUMNS in ${importContractPath}`);
  const columns = [...block[1].matchAll(/\{\s*header:\s*"((?:[^"\\]|\\.)*)",\s*field:\s*"([A-Za-z]+)"/g)]
    .map(([, header, field]) => ({ header, field }));
  if (columns.length === 0) throw new Error("PRODUCT_IMPORT_COLUMNS parsed as empty.");
  return columns;
}

function parseNumberCell(value, label, rowNumber) {
  const raw = value.trim();
  if (raw === "") return 0;
  if (!/^-?\d+(\.\d+)?$/.test(raw)) {
    throw new Error(`Row ${rowNumber}: ${label} is "${raw}", which is not a plain number. `
      + "The generated module must round-trip back to this CSV byte for byte, so formatted "
      + "numbers (1,200 / ₹99 / 1.0) have to be fixed in build_catalog.py first.");
  }
  const parsed = Number(raw);
  if (String(parsed) !== raw) {
    throw new Error(`Row ${rowNumber}: ${label} "${raw}" does not round-trip through JavaScript (got "${String(parsed)}").`);
  }
  return parsed;
}

function parseBooleanCell(value, label, rowNumber) {
  const raw = value.trim().toLowerCase();
  if (raw === "yes") return true;
  if (raw === "no") return false;
  throw new Error(`Row ${rowNumber}: ${label} is "${value}"; the starter catalog uses only yes/no.`);
}

function parseAliasesCell(value, rowNumber) {
  const aliases = value.split(",").map((alias) => alias.trim()).filter(Boolean);
  if (aliases.join(", ") !== value.trim()) {
    throw new Error(`Row ${rowNumber}: aliases "${value}" do not round-trip through ", " separation.`);
  }
  return aliases;
}

function rowToItem(cells, columns, rowNumber) {
  const cell = (field) => (cells[columns.findIndex((column) => column.field === field)] ?? "").trim();
  const label = (field) => columns.find((column) => column.field === field)?.header ?? field;
  const number = (field) => parseNumberCell(cell(field), label(field), rowNumber);
  return {
    name: cell("name"),
    category: cell("category"),
    unit: cell("unit"),
    skuBarcode: cell("skuBarcode"),
    mrp: number("mrp"),
    costPrice: number("costPrice"),
    sellingPrice: number("sellingPrice"),
    gstRate: number("gstRate"),
    stockQuantity: number("stockQuantity"),
    lowStockAlert: number("lowStockAlert"),
    reorderLevel: number("reorderLevel"),
    hsn: cell("hsn"),
    brand: cell("brand"),
    aliases: parseAliasesCell(cell("aliasesText"), rowNumber),
    description: cell("description"),
    packSizeValue: number("packSizeValue"),
    packSizeUnit: cell("packSizeUnit"),
    isLooseItem: parseBooleanCell(cell("isLooseItem"), label("isLooseItem"), rowNumber),
    isActive: parseBooleanCell(cell("isActive"), label("isActive"), rowNumber),
  };
}

function serialiseItem(item) {
  const parts = Object.entries(item).map(([key, value]) => {
    if (Array.isArray(value)) return `${key}: [${value.map((entry) => JSON.stringify(entry)).join(", ")}]`;
    return `${key}: ${JSON.stringify(value)}`;
  });
  return `  { ${parts.join(", ")} },`;
}

function buildModule(items, checksum) {
  const looseCount = items.filter((item) => item.isLooseItem).length;
  return [
    "// GENERATED FILE — do not edit by hand.",
    "// Source: catalog/kirana-starter-catalog.csv",
    "// Regenerate: npm run catalog:generate (from frontend/)",
    "//",
    `// ${items.length} products, ${looseCount} sold loose by weight, ${new Set(items.map((item) => item.category)).size} categories.`,
    "// Prices are starting values a shop is expected to correct, not quoted facts; the",
    "// durable part is the names, Hindi/Hinglish aliases, categories, pack sizes and HSN.",
    "//",
    "// This module is loaded with a dynamic import so its weight never reaches a counter",
    "// that does not open first-run setup. Do not import it statically from a screen.",
    "",
    'import { freezeStarterCatalog, type StarterCatalogItem } from "./starter-catalog";',
    "",
    "/** sha256 of the source CSV, line-ending and BOM normalised. Pins this file to that one. */",
    `export const KIRANA_STARTER_CATALOG_CHECKSUM = ${JSON.stringify(checksum)};`,
    "",
    "export const KIRANA_STARTER_CATALOG: readonly StarterCatalogItem[] = freezeStarterCatalog([",
    ...items.map(serialiseItem),
    "]);",
    "",
  ].join("\n");
}

/**
 * The counts, split into their own module so a screen can say "Load 560 items" on a
 * button without downloading the 560 items to render that label. Anything imported
 * here is imported eagerly by the setup screen — keep it to primitives.
 */
function buildSummaryModule(items, checksum) {
  return [
    "// GENERATED FILE — do not edit by hand.",
    "// Source: catalog/kirana-starter-catalog.csv",
    "// Regenerate: npm run catalog:generate (from frontend/)",
    "//",
    "// Counts only. This module is safe to import eagerly; the catalog itself is not.",
    "",
    `export const KIRANA_STARTER_CATALOG_COUNT = ${items.length};`,
    `export const KIRANA_STARTER_CATALOG_LOOSE_COUNT = ${items.filter((item) => item.isLooseItem).length};`,
    `export const KIRANA_STARTER_CATALOG_CATEGORY_COUNT = ${new Set(items.map((item) => item.category)).size};`,
    "",
    "/** Same checksum the data module carries, so a stale summary fails the same test. */",
    `export const KIRANA_STARTER_CATALOG_SUMMARY_CHECKSUM = ${JSON.stringify(checksum)};`,
    "",
  ].join("\n");
}

/**
 * Everything generation does, with no disk writes, so the staleness test can rebuild the
 * modules in memory and diff them against the committed files. A test that shelled out to
 * this script would be testing the script's ability to write, not the files' freshness.
 */
export function buildStarterCatalogModules(csvText, importContractText) {
  const columns = readImportColumns(importContractText);
  const grid = parseCsv(csvText);
  if (grid.length < 2) throw new Error(`${csvPath} has no data rows.`);

  const headers = grid[0].map((header) => header.trim());
  const expected = columns.map((column) => column.header);
  if (headers.length !== expected.length || headers.some((header, index) => header !== expected[index])) {
    throw new Error("The CSV header row no longer matches PRODUCT_IMPORT_COLUMNS.\n"
      + `  CSV:      ${headers.join(",")}\n`
      + `  Importer: ${expected.join(",")}`);
  }

  const items = grid.slice(1).map((cells, index) => rowToItem(cells, columns, index + 1));
  const names = new Set();
  for (const item of items) {
    const key = item.name.trim().toLowerCase();
    // The server rejects a duplicate active product name (409 PRODUCT_NAME_DUPLICATE), so a
    // duplicate here would sync-fail forever on whichever row lost the race.
    if (names.has(key)) throw new Error(`Duplicate product name in the CSV: "${item.name}".`);
    names.add(key);
  }

  const checksum = checksumCatalogCsv(csvText);
  return {
    items,
    dataModule: buildModule(items, checksum),
    summaryModule: buildSummaryModule(items, checksum),
  };
}

/** Paths the generator owns, exported so the staleness test reads the same ones. */
export const STARTER_CATALOG_PATHS = {
  csv: csvPath,
  importContract: importContractPath,
  data: outputPath,
  summary: summaryPath,
};

function main() {
  const { items, dataModule, summaryModule } = buildStarterCatalogModules(
    readFileSync(csvPath, "utf8"),
    readFileSync(importContractPath, "utf8"),
  );
  mkdirSync(outputDir, { recursive: true });
  writeFileSync(outputPath, dataModule, "utf8");
  writeFileSync(summaryPath, summaryModule, "utf8");
  console.log(`Wrote ${items.length} items (${items.filter((item) => item.isLooseItem).length} loose) to ${outputPath}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    main();
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
