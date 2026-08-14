import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * Finds user-visible English text that was written into a component instead of the
 * dictionary. A string that never reaches `t()` cannot be translated, so it survives
 * every completeness test and still shows up in English mid-bill — this is the check
 * that stops the dictionary from being quietly bypassed.
 *
 * It is deliberately conservative. Everything it flags is something a shopkeeper can
 * read on screen; things it cannot judge (aria labels, className strings, keys) are
 * left alone rather than producing noise that trains people to add allowlist entries.
 */

export interface HardcodedString {
  line: number;
  kind: "jsx-text" | "toast" | "thrown" | "prop";
  text: string;
}

/**
 * Props whose value is read off the screen rather than by the browser.
 *
 * This list is why the check exists in this shape. For a long time it only read
 * text BETWEEN tags, so `label="Printer model"` and `title="GST Configuration"`
 * were invisible to it — and roughly six hundred strings sat on screens the test
 * called clean, which is how the app came to render half in Hindi and half in
 * English with every guard green.
 *
 * `value` earns its place: `value={count > 0 ? "Items to reorder" : "Healthy"}`
 * is a card's entire visible content. `aria-label` earns its place because a
 * screen reader is a user too.
 */
const PROSE_ATTRIBUTES =
  "label|title|sub|subtitle|desc|description|detail|caption|hint|placeholder|value|text|message|note|confirmLabel|cancelLabel|actionLabel|emptyText|emptyTitle|tooltip|aria-label";

/** Strings that are not words: punctuation, numbers, currency, single symbols. */
function isUserVisibleText(value: string): boolean {
  const text = value.trim();
  if (text.length < 3) return false;
  // Must contain at least two consecutive Latin letters to be a word rather than a
  // unit, a symbol, or an already-translated Devanagari string.
  if (!/[A-Za-z]{2}/.test(text)) return false;
  // Format-only fragments and code-ish tokens.
  if (/^[{<]/.test(text)) return false;
  if (/^(https?:|\/|#|data:)/.test(text)) return false;
  // A call expression is code, not prose: `window.print()`, `roundMoney(entry.x)`.
  // An identifier immediately followed by "(" never occurs in a label; real UI text
  // that uses brackets puts a space first, as in "Amount (₹)".
  if (/\w\(/.test(text)) return false;
  // JSX ternary glue: `</div> : cond ? <div>` reads as ">text<" to this regex.
  // No user-visible label begins with ":" or ")".
  if (/^[:)]/.test(text)) return false;
  // Operators and type syntax that a label can never contain. Without these, a JSX
  // guard (`{points > 0 && <Badge/>}`) and a generic signature
  // (`loadSettingList<T>(key: string, fallback: T[]): Promise<T[]>`) both read as
  // ">text<" and were counted as untranslated prose — which kept whole files pinned
  // to the allowlist over strings that do not exist. Reporting code as debt is worse
  // than missing it: it makes the list unshrinkable and teaches people to ignore it.
  if (/&&|\|\||=>|\[\]/.test(text)) return false;
  return true;
}

/**
 * A second filter for attribute values only, where `isUserVisibleText` is not
 * enough. Between tags, anything word-shaped is prose. In an attribute it is
 * usually not: `type="button"`, `variant="destructive"`, `key="catalog:read"` and
 * `id="gst-rate-help"` all pass the first filter and none of them is read by
 * anyone. Flagging those would bury the real findings, which is the failure mode
 * that made the previous version of this list unshrinkable.
 */
function isProse(value: string): boolean {
  // A single lowercase word is an identifier or an enum member, not a label.
  if (!/ /.test(value) && !/^[A-Z]/.test(value)) return false;
  if (/^[a-z]+([A-Z][a-z]*)+$/.test(value)) return false;
  // kebab-case and snake_case tokens: ids, CSS values, query keys.
  if (/^[\w-]+$/.test(value) && /[-_]/.test(value)) return false;
  // A single token mixing letters and digits is a code, not a sentence:
  // `MH12AB1234` and `ABC234` are a sample vehicle registration and a sample
  // pairing code shown as placeholder text. Translating either would put a wrong
  // number on screen, so they must not be reported as debt.
  if (!/ /.test(value) && /\d/.test(value)) return false;
  return true;
}

function stripCommentsAndClasses(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "")
    // className/class strings are Tailwind, not prose, and dominate this codebase.
    .replace(/className=\{?["'`][\s\S]*?["'`]\}?/g, "className={}")
    .replace(/data-testid=["'][^"']*["']/g, "");
}

export function findHardcodedStrings(source: string): HardcodedString[] {
  const cleaned = stripCommentsAndClasses(source);
  const lineOf = (index: number) => cleaned.slice(0, index).split("\n").length;
  const found: HardcodedString[] = [];

  // 1. Bare JSX text: >Move to recycle bin<
  //    The lookbehind keeps `=>`, `<=` and `>=` from opening a match: an arrow
  //    function followed by a comparison or a generic reads as ">text<" otherwise,
  //    and `() => apiRequest<{...}>` was reported as the user-visible word "apiRequest".
  for (const match of cleaned.matchAll(/(?<![=!<>])>(?!=)([^<>{}\n]+)</g)) {
    if (isUserVisibleText(match[1])) {
      found.push({ line: lineOf(match.index ?? 0), kind: "jsx-text", text: match[1].trim() });
    }
  }

  // 2. Toast copy: the message a shopkeeper reads when something went wrong, which is
  //    exactly where an English string does the most damage to trust.
  for (const call of cleaned.matchAll(/\btoast\(\s*\{[\s\S]{0,600}?\}\s*\)/g)) {
    for (const field of call[0].matchAll(/\b(?:title|description)\s*:\s*"([^"]+)"/g)) {
      if (isUserVisibleText(field[1])) {
        found.push({ line: lineOf(call.index ?? 0), kind: "toast", text: field[1] });
      }
    }
  }

  // 3. Thrown messages that surface to the user through an error toast.
  for (const match of cleaned.matchAll(/throw new Error\(\s*"([^"]{10,})"/g)) {
    if (isUserVisibleText(match[1])) {
      found.push({ line: lineOf(match.index ?? 0), kind: "thrown", text: match[1] });
    }
  }

  // 4. Prose passed as a prop or held in an object literal, which renders exactly
  //    like text between tags but parses as an attribute or a property. Both forms
  //    are matched: `label="Low stock"` and `{ label: "Low stock", href: "..." }`.
  //    The second is how nav lists, tile grids and status tables are written, and
  //    prose in a MODULE-LEVEL one cannot be translated at all without turning the
  //    constant into a function — a constant is evaluated at import, before a
  //    language is chosen.
  //    A toast title matches both this rule and rule 2, so anything already
  //    reported is skipped — one string should be one finding.
  const seen = new Set(found.map((hit) => hit.text));
  for (const match of cleaned.matchAll(new RegExp(`\\b(?:${PROSE_ATTRIBUTES})\\s*[:=]\\s*"([^"]{3,})"`, "g"))) {
    if (seen.has(match[1])) continue;
    if (isUserVisibleText(match[1]) && isProse(match[1])) {
      seen.add(match[1]);
      found.push({ line: lineOf(match.index ?? 0), kind: "prop", text: match[1] });
    }
  }

  return found;
}

/** Repo-relative, forward-slashed, so the allowlist reads the same on every platform. */
export function toPosixPath(root: string, absolute: string): string {
  return relative(root, absolute).split(sep).join("/");
}

export function collectSourceFiles(root: string, subdirectories: string[]): string[] {
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        if (entry === "node_modules" || entry === "tests") continue;
        walk(full);
      } else if (entry.endsWith(".tsx")) {
        files.push(full);
      }
    }
  };
  for (const subdirectory of subdirectories) walk(join(root, subdirectory));
  return files.sort();
}
