import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { collectSourceFiles, findHardcodedStrings, toPosixPath } from "./i18n-hardcoded-strings";
import { I18N_HARDCODED_ALLOWLIST } from "./i18n-hardcoded-allowlist";

/**
 * A string written into a component never reaches the dictionary, so it passes every
 * completeness test and still renders in English on a Hindi counter. This is the check
 * that stops the dictionary from being bypassed.
 *
 * It enforces strictly on every file NOT in the allowlist, which is what makes it
 * useful before the migration is finished: files already translated can never regress,
 * and new screens must use `t()` from the first commit.
 */
const sourceRoot = fileURLToPath(new URL("..", import.meta.url));
const allowlistPaths = Object.keys(I18N_HARDCODED_ALLOWLIST);

describe("hardcoded user-visible strings", () => {
  const files = collectSourceFiles(sourceRoot, ["features", "components", "app"]);

  it("scans a plausible number of components", () => {
    // Guards the walker itself: a bad path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds none outside the allowlist, and no more than it records inside", () => {
    // A listed file is not a free pass: it is a ceiling. Translating is the only way
    // the number moves, so a new English label on an already-indebted page fails here
    // exactly as it would on a clean one.
    const offenders: string[] = [];
    for (const file of files) {
      const path = toPosixPath(sourceRoot, file);
      const budget = I18N_HARDCODED_ALLOWLIST[path] ?? 0;
      const hits = findHardcodedStrings(readFileSync(file, "utf8"));
      if (hits.length > budget) {
        const first = hits[budget];
        offenders.push(`${path}: ${hits.length} strings, allowlist records ${budget} — e.g. line ${first.line} (${first.kind}) "${first.text}"`);
      }
    }
    expect(
      offenders,
      "User-visible text must go through t(). Move these into a translations module, or — only if this file is genuinely pre-existing debt — raise its count in i18n-hardcoded-allowlist.ts.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest: every entry still exists and still offends by its count", () => {
    // An allowlist that outlives its debt silently shrinks the enforced set. A file that
    // has been translated must be REMOVED from the list, not left behind as cover — and
    // a count left above the real one is the same cover in smaller print, because it
    // leaves room for a new English string to slip in unreported.
    const known = new Set(files.map((file) => toPosixPath(sourceRoot, file)));
    const stale: string[] = [];
    for (const [path, budget] of Object.entries(I18N_HARDCODED_ALLOWLIST)) {
      if (!known.has(path)) {
        stale.push(`${path} — no longer exists; delete this line`);
        continue;
      }
      const hits = findHardcodedStrings(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));
      if (hits.length === 0) stale.push(`${path} — now clean; delete this line to lock it in`);
      else if (hits.length < budget) stale.push(`${path} — down to ${hits.length}; lower the count from ${budget} to lock the progress in`);
    }
    expect(stale).toEqual([]);
  });

  it("is sorted, so the debt is readable", () => {
    // Duplicate keys are a compile error in an object literal, so only order is left
    // to assert — and order is what keeps a 137-line ledger reviewable in a diff.
    expect(allowlistPaths).toEqual([...allowlistPaths].sort());
  });

  it("detects a bare JSX string, a bare toast and a thrown message", () => {
    // The detector is the whole point; a broken one would make the suite green and the
    // rule meaningless. These are the three shapes it claims to catch.
    expect(findHardcodedStrings("<Button>Move to recycle bin</Button>")).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Move to recycle bin" }),
    ]);
    expect(findHardcodedStrings('toast({ title: "Could not save the bill" })')).toEqual([
      expect.objectContaining({ kind: "toast", text: "Could not save the bill" }),
    ]);
    expect(findHardcodedStrings('throw new Error("Owner PIN is required for this")')).toEqual([
      expect.objectContaining({ kind: "thrown", text: "Owner PIN is required for this" }),
    ]);
  });

  it("detects prose a ternary used to hide, between tags and inside a prop", () => {
    // The shape this check was blind to for its whole life: both arms render, and
    // neither is a bare `prop="literal"` nor brace-free text between tags. An
    // inventory screen shipped a whole stock table in English behind it.
    expect(findHardcodedStrings('<span>{out ? "Out of stock" : "In stock"}</span>')).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Out of stock" }),
      expect.objectContaining({ kind: "jsx-text", text: "In stock" }),
    ]);
    expect(findHardcodedStrings('<Label label={mode === "correction" ? "New stock" : "Quantity"} />')).toEqual([
      expect.objectContaining({ kind: "prop", text: "New stock" }),
      expect.objectContaining({ kind: "prop", text: "Quantity" }),
    ]);
    // Text that merely CONTAINS a value is still text. Requiring the run to be
    // brace-free skipped the ordinary way a row is written.
    expect(findHardcodedStrings("<p>Category: {item.category}</p>")).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Category:" }),
    ]);
  });

  it("does not flag the operand a ternary compares against", () => {
    // `mode === "correction"` is code sitting in the same expression as the prose.
    // Reporting it would make the finding list unshrinkable, which is the failure
    // mode that already cost this check its credibility once.
    const hits = findHardcodedStrings('<span>{mode === "correction" ? "Stock fixed" : "Sale"}</span>');
    expect(hits.map((hit) => hit.text)).not.toContain("correction");
  });

  it("does not flag date patterns, style blocks or code between empty strings", () => {
    // Three shapes that only became reachable once braces were allowed inside a
    // text run — all machine tokens, none of them read by a shopkeeper.
    expect(findHardcodedStrings('<p>{format(row.createdAt, "d MMM, h:mm a")}</p>')).toEqual([]);
    expect(findHardcodedStrings("<style>body h1 { margin: 0 } table th,td { padding: 2px }</style>")).toEqual([]);
    expect(findHardcodedStrings('<span>{up ? "+" : ""}{qty} {row.unit ?? ""}</span>')).toEqual([]);
    // ...while a real label built the same way is still reported, with the values
    // blanked out so the finding reads as the sentence that needs a dictionary key.
    expect(findHardcodedStrings("<p>Showing {first} of {total} products</p>")).toEqual([
      expect.objectContaining({ kind: "jsx-text", text: "Showing   of   products" }),
    ]);
  });

  it("does not flag translated calls, class names, numbers or Devanagari", () => {
    // False positives train people to add allowlist entries, which is how a lint like
    // this dies. These are the shapes it must stay quiet about.
    expect(findHardcodedStrings("<span>{t(\"billing.total\")}</span>")).toEqual([]);
    expect(findHardcodedStrings("const valid = count >= minimum && count <= maximum;")).toEqual([]);
    expect(findHardcodedStrings('<div className="flex items-center gap-2">{value}</div>')).toEqual([]);
    expect(findHardcodedStrings("<span>₹1,240.00</span>")).toEqual([]);
    expect(findHardcodedStrings("<span>उधार खाता</span>")).toEqual([]);
    expect(findHardcodedStrings("<span>· ×</span>")).toEqual([]);
    expect(findHardcodedStrings("{loading ? <A /> : query.isError ? <B /> : <C />}")).toEqual([]);
  });
});
