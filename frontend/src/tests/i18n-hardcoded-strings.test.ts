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
const allowlist = new Set(I18N_HARDCODED_ALLOWLIST);

describe("hardcoded user-visible strings", () => {
  const files = collectSourceFiles(sourceRoot, ["features", "components", "app"]);

  it("scans a plausible number of components", () => {
    // Guards the walker itself: a bad path would make every assertion below vacuous.
    expect(files.length).toBeGreaterThan(200);
  });

  it("finds none outside the grandfathered allowlist", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const path = toPosixPath(sourceRoot, file);
      if (allowlist.has(path)) continue;
      const hits = findHardcodedStrings(readFileSync(file, "utf8"));
      if (hits.length > 0) {
        offenders.push(`${path}:${hits[0].line} (${hits[0].kind}) "${hits[0].text}"${hits.length > 1 ? ` +${hits.length - 1} more` : ""}`);
      }
    }
    expect(
      offenders,
      "User-visible text must go through t(). Move these into a translations module, or — only if this file is genuinely pre-existing debt — add it to i18n-hardcoded-allowlist.ts.",
    ).toEqual([]);
  });

  it("keeps the allowlist honest: every entry still exists and still offends", () => {
    // An allowlist that outlives its debt silently shrinks the enforced set. A file that
    // has been translated must be REMOVED from the list, not left behind as cover.
    const known = new Set(files.map((file) => toPosixPath(sourceRoot, file)));
    const stale: string[] = [];
    for (const path of I18N_HARDCODED_ALLOWLIST) {
      if (!known.has(path)) {
        stale.push(`${path} — no longer exists; delete this line`);
        continue;
      }
      const hits = findHardcodedStrings(readFileSync(fileURLToPath(new URL(`../${path}`, import.meta.url)), "utf8"));
      if (hits.length === 0) stale.push(`${path} — now clean; delete this line to lock it in`);
    }
    expect(stale).toEqual([]);
  });

  it("is sorted and free of duplicates, so the debt is readable", () => {
    expect(I18N_HARDCODED_ALLOWLIST).toEqual([...new Set(I18N_HARDCODED_ALLOWLIST)]);
    expect([...I18N_HARDCODED_ALLOWLIST]).toEqual([...I18N_HARDCODED_ALLOWLIST].sort());
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
