import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { translateCategory } from "@/features/core/settings/business-types";
import { reportCategoryLabel, UNCATEGORISED_CATEGORY } from "@/features/core/reports/local-reporting";
import { loadHindiDictionary, type Translate, type TranslationKey } from "@/features/core/settings/i18n";
import { englishTranslations } from "@/features/core/settings/translations/english";

/**
 * A product's category is STORED as a key — "finished_goods", "main_course",
 * "engine_parts" — because it has to mean the same thing on both sides of the
 * network and in both languages. So every screen that shows one has to turn it
 * into words first, and the only thing that does that is `translateCategory`.
 *
 * Printing the field instead is a silent defect: it type-checks, it renders, and
 * a factory owner reads "finished_goods" on the reports page in either language.
 * It had happened on nine screens at once, which is why this file sweeps rather
 * than pinning the nine.
 */

const enT: Translate = (key, vars) => interpolate(englishTranslations[key] ?? key, vars);

function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (vars[name] === undefined ? match : String(vars[name])));
}

describe("a stored category becomes words before it is shown", () => {
  it("gives a shipped category the trade's own vocabulary, in both languages", async () => {
    const hindi = await loadHindiDictionary();
    expect(hindi, "Hindi table failed to load — the Hindi case below would be vacuous").toBeTruthy();
    const hiT: Translate = (key, vars) => interpolate(hindi?.[key] ?? englishTranslations[key] ?? key, vars);

    expect(translateCategory("finished_goods", enT)).toBe("Finished Goods");
    expect(translateCategory("finished_goods", hiT)).toBe("तैयार माल");
    expect(translateCategory("main_course", hiT)).toBe("मुख्य भोजन");
  });

  it("shows a category the shop invented exactly as the shop typed it", () => {
    // No key exists for it and none should be guessed: "Bhaiya ka stock" is the
    // owner's own word, in whatever language they wrote it.
    expect(translateCategory("Dry Fruits", enT)).toBe("Dry Fruits");
    expect(translateCategory("मिठाई", enT)).toBe("मिठाई");
    // Underscores are the one thing a person never types: a value carrying them
    // came from a key-shaped source, so it is read as words.
    expect(translateCategory("bulk_orders", enT)).toBe("bulk orders");
  });

  it("falls back to the stored value while the dictionary chunk is still loading", () => {
    // `t()` answers with the key itself until the deferred half lands. A chip
    // reading "shopType.category.grocery" for that moment is worse than one
    // reading "grocery".
    const coldT: Translate = (key) => key;
    expect(translateCategory("finished_goods", coldT)).toBe("finished goods");
  });

  it("names the sales a report could not file under any category", async () => {
    const hindi = await loadHindiDictionary();
    const hiT: Translate = (key, vars) => interpolate(hindi?.[key] ?? englishTranslations[key] ?? key, vars);
    expect(reportCategoryLabel(UNCATEGORISED_CATEGORY, enT)).toBe("Uncategorised");
    expect(reportCategoryLabel(UNCATEGORISED_CATEGORY, hiT)).toBe("बिना कैटेगरी");
    // Everything else is an ordinary category.
    expect(reportCategoryLabel("raw_material", enT)).toBe("Raw Material");
  });

  it("keeps the words out of the stored value", () => {
    // The sentinel is English on purpose: it travels in the exported snapshot,
    // which must read the same whatever language exported it.
    expect(UNCATEGORISED_CATEGORY).toBe("Uncategorised");
  });
});

/**
 * Shapes that print a category without translating it. Each one is a real bug
 * that was on screen: the raw field between tags, the raw field with only its
 * EMPTY case translated, and a hand-rolled underscore swap.
 */
const RAW_CATEGORY_RULES: Array<{ label: string; pattern: RegExp }> = [
  { label: "printed straight from the record", pattern: /\{\s*[A-Za-z_$][\w$]*(?:\??\.[\w$]+)*\??\.category\s*\}/g },
  { label: "translated only when it is missing", pattern: /\.category\s*(?:\?\?|\|\|)\s*t\(/g },
  { label: "hand-humanised instead of translated", pattern: /\b(?:cat|category|categoryName)\s*\)?\s*\.replace\(/g },
];

/**
 * Screens whose `category` is NOT a product category.
 *
 * Expense categories are deliberately stored display text (see
 * `settings/shop-expenses.ts`: translating them would file one expense under two
 * names); a ledger account's category and an integration's category are fixed
 * English taxonomies that never came from a shop's catalogue.
 */
const NOT_A_PRODUCT_CATEGORY = new Set([
  "features/core/expenses/pages/ExpensesPage.tsx",
  "features/core/reports/components/AccountingControlPanel.tsx",
  "features/core/settings/pages/IntegrationsSettingsPage.tsx",
]);

function screens(root: string): string[] {
  const found: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "tests") continue;
        walk(full);
      } else if (entry.endsWith(".tsx")) {
        found.push(full);
      }
    }
  };
  walk(root);
  return found.sort();
}

function withoutComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

describe("no screen prints a stored product category", () => {
  it("routes every category on screen through translateCategory", () => {
    const offenders: string[] = [];
    for (const file of screens("src")) {
      const path = relative("src", file).split(sep).join("/");
      if (NOT_A_PRODUCT_CATEGORY.has(path)) continue;
      const source = withoutComments(readFileSync(file, "utf8"));
      for (const { label, pattern } of RAW_CATEGORY_RULES) {
        for (const match of source.matchAll(pattern)) {
          const line = source.slice(0, match.index ?? 0).split("\n").length;
          offenders.push(`${path}:${line} — ${label}: ${match[0].trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });

  it("keeps the allowlist honest", () => {
    // An entry that stops offending is an entry that should be deleted, or the
    // list quietly becomes permission to print the next one raw.
    const stale: string[] = [];
    for (const path of NOT_A_PRODUCT_CATEGORY) {
      const source = withoutComments(readFileSync(join("src", path), "utf8"));
      if (!RAW_CATEGORY_RULES.some(({ pattern }) => new RegExp(pattern.source).test(source))) {
        stale.push(`${path} no longer prints a bare category — drop it from the list`);
      }
    }
    expect(stale).toEqual([]);
  });
});

/** The key catalogue is the one place these words may live. */
describe("the category words themselves", () => {
  it("has a Hindi word for the sales a report cannot file", async () => {
    const key = "reports.category.uncategorised" satisfies TranslationKey;
    const hindi = await loadHindiDictionary();
    expect(englishTranslations[key]).toBeTruthy();
    expect(hindi?.[key]).toBeTruthy();
  });
});
