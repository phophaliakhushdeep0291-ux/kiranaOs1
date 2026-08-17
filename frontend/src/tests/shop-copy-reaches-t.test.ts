import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { BUSINESS_TYPE_DEFS, type BusinessType } from "@/features/core/settings/business-types";
import { SHOP_WORKFLOWS } from "@/features/core/settings/shop-workflows";
import { englishTranslations, loadHindiDictionary, type TranslationKey } from "@/features/core/settings/i18n";
import { VERTICAL_PACKS } from "@/features/verticals/registry";

/**
 * The per-trade config tables hold dictionary KEYS, and `TranslationKey` is a
 * union of string literals — so `{action.label}` compiles perfectly and prints
 * "shopType.restaurant.action.1" on the dashboard. tsc cannot help here, and
 * neither can the hardcoded-string scanner: there is no English in the component
 * to find. Three of the four dashboard layouts shipped exactly that.
 *
 * So the rule is enforced on the source: every read of a keyed field has to be
 * wrapped in `t(`. Cheap, and it fails on the one mistake this design allows.
 */

/** Keyed fields, by the expression that reads one. */
const KEYED_READS = [
  "action.label", "action.detail",
  "workflow.title", "workflow.subtitle",
  "productEntry.helper", "productEntry.nameLabel", "productEntry.namePlaceholder",
  "productEntry.looseNamePlaceholder", "productEntry.brandLabel", "productEntry.brandPlaceholder",
  "productEntry.identifierLabel", "productEntry.identifierPlaceholder",
  "productEntry.notesLabel", "productEntry.notesPlaceholder", "productEntry.batchRecommendation",
  "dbCfg.heroTitle", "dbCfg.heroSubtitle", "dbCfg.creditLabel",
  "dbCfg.kpi.revenue", "dbCfg.kpi.profit", "dbCfg.kpi.credit", "dbCfg.kpi.cash",
  "btDef.navConfig.billing", "btDef.navConfig.products", "btDef.navConfig.inventory",
  "btDef.navConfig.udhar", "btDef.navConfig.tagline",
  "def.labelKey", "def.descriptionKey", "typeDef.labelKey", "typeDef.descriptionKey",
];

/** Files that read the per-trade tables and render them. */
const CONSUMERS = [
  "src/features/core/dashboard/pages/DashboardPage.tsx",
  "src/features/core/products/pages/components/ProductFormPanel.tsx",
  "src/components/layout/Layout.tsx",
  "src/components/layout/MobileAppChrome.tsx",
  "src/features/core/auth/pages/RegisterPage.tsx",
  "src/features/core/settings/pages/StoreProfilePage.tsx",
  "src/features/core/subscription/pages/PlansPage.tsx",
];

function stripKeyProps(line: string): string {
  let out = "";
  let index = 0;
  for (;;) {
    const at = line.indexOf("key={", index);
    if (at === -1) return out + line.slice(index);
    out += line.slice(index, at);
    let depth = 0;
    let cursor = at + "key=".length;
    for (; cursor < line.length; cursor += 1) {
      if (line[cursor] === "{") depth += 1;
      else if (line[cursor] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    index = cursor + 1;
  }
}

describe("per-trade copy actually reaches t()", () => {
  it("wraps every read of a keyed field", () => {
    const unwrapped: string[] = [];
    for (const file of CONSUMERS) {
      const source = readFileSync(file, "utf8");
      const lines = source.split("\n");
      lines.forEach((line, index) => {
        // A React `key=` prop is not rendered, so a bare key there is harmless.
        // Brace-counted rather than `[^}]*`, because a key is often a template
        // literal — `key={`${action.href}-${action.label}`}` — and the naive form
        // stopped at the inner `}` and then reported the rest as a render.
        const scannable = stripKeyProps(line);
        for (const read of KEYED_READS) {
          let from = 0;
          for (;;) {
            const at = scannable.indexOf(read, from);
            if (at === -1) break;
            from = at + read.length;
            // Accept `t(<read>` and `t(<read>,` — the only correct shapes. Also
            // accept a longer property path that happens to contain this one.
            const before = scannable.slice(Math.max(0, at - 2), at);
            const after = scannable.charAt(from);
            if (/[A-Za-z0-9_$.]/.test(after)) continue; // part of a longer path
            if (before === "t(") continue;
            // `const x = def.labelKey` style assignment is fine; only a JSX read
            // or a prop value renders. Both sit inside braces on this line.
            if (!/[{(]/.test(scannable.slice(Math.max(0, at - 1), at))) continue;
            unwrapped.push(`${file}:${index + 1} — ${read} is rendered without t()`);
          }
        }
      });
    }
    expect(unwrapped).toEqual([]);
  });

  it("resolves every trade's whole panel to real words in both languages", async () => {
    // The other half of the same guarantee: the keys the tables name must exist.
    // A key with no entry would print itself just as loudly as a missing t().
    const hindi = await loadHindiDictionary();
    expect(hindi, "Hindi table failed to load — the Hindi half would be vacuous").toBeTruthy();

    const missing: string[] = [];
    const check = (key: TranslationKey, where: string) => {
      if (!(key in englishTranslations)) missing.push(`${where}: ${key} missing from English`);
      else if (!hindi?.[key]) missing.push(`${where}: ${key} missing from Hindi`);
    };

    for (const businessType of Object.keys(BUSINESS_TYPE_DEFS) as BusinessType[]) {
      const workflow = SHOP_WORKFLOWS[businessType];
      check(workflow.title, businessType);
      check(workflow.subtitle, businessType);
      for (const action of workflow.actions) {
        check(action.label, businessType);
        check(action.detail, businessType);
      }
      for (const [field, key] of Object.entries(workflow.productEntry)) {
        if (typeof key === "string") check(key as TranslationKey, `${businessType} productEntry.${field}`);
      }
    }
    for (const pack of VERTICAL_PACKS) {
      for (const entry of pack.nav) {
        check(entry.label, pack.id);
        if (entry.mobile) check(entry.mobile.helper, pack.id);
      }
    }
    expect(missing).toEqual([]);
  });
});
