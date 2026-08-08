/**
 * backup-drill-verify.js — proves the drill can FAIL.
 *
 * Run: npm run backup:drill:verify
 *
 * A green drill on its own is close to worthless as evidence. It shows that nothing went
 * wrong on that run; it does not show that anything WOULD have been caught. A drill whose
 * reconciliation silently compared nothing would look exactly as green.
 *
 * So this runs the drill three times against a deliberately small dataset:
 *
 *   1. clean            — must exit 0
 *   2. one paise added  — must exit 1 and name totalSalesPaise
 *   3. one unit added   — must exit 1 and name stockByProduct
 *
 * A paise is the smallest amount the system can represent, and a unit the smallest stock
 * movement, so passing 2 and 3 means the reconciliation has no tolerance hiding in it.
 */
import { spawnSync } from "node:child_process";
import path from "node:path";
import process from "node:process";

const drill = path.join(process.cwd(), "scripts", "backup-drill.js");
const runner = path.join(process.cwd(), "scripts", "run-with-env.js");

function runDrill(label, extraEnv) {
  process.stdout.write(`▶ ${label}\n`);
  // "node", not process.execPath: run-with-env spawns the inner command through a shell,
  // and on Windows the interpreter path contains a space ("C:\Program Files\…") that the
  // shell splits into a command it cannot find.
  return spawnSync(process.execPath, [runner, "PRISMA_CLIENT_VARIANT=integration", "--", "node", drill], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: {
      ...process.env,
      // The drill is a short proof, not the full year: three runs of 216 bills would
      // add minutes to the gate without testing anything the small one does not.
      DRILL_MONTHS: "1",
      DRILL_BILLS_PER_MONTH: "3",
      ...extraEnv,
    },
    timeout: 600_000,
  });
}

const failures = [];

function expect(condition, message, result) {
  if (condition) return;
  failures.push(message);
  console.error(`  ✖ ${message}`);
  if (result) {
    console.error(`    stdout: ${String(result.stdout || "").trim().split("\n").slice(-4).join("\n            ")}`);
    console.error(`    stderr: ${String(result.stderr || "").trim().split("\n").slice(-4).join("\n            ")}`);
  }
}

const clean = runDrill("clean run must pass", {});
expect(clean.status === 0, "a clean drill must exit 0", clean);
expect(/BACKUP DRILL PASSED/.test(clean.stdout || ""), "a clean drill must report PASSED", clean);

const paise = runDrill("one paise of drift must fail", { DRILL_INJECT_DRIFT: "paise" });
expect(paise.status === 1, "a 1-paise drift must exit 1", paise);
expect(/DRILL FAILED/.test(paise.stderr || ""), "a 1-paise drift must report DRILL FAILED", paise);
expect(/totalSalesPaise/.test(paise.stderr || ""), "a 1-paise drift must name totalSalesPaise", paise);

const stock = runDrill("one stock unit of drift must fail", { DRILL_INJECT_DRIFT: "stock" });
expect(stock.status === 1, "a 1-unit stock drift must exit 1", stock);
expect(/DRILL FAILED/.test(stock.stderr || ""), "a 1-unit stock drift must report DRILL FAILED", stock);
expect(/stockByProduct/.test(stock.stderr || ""), "a 1-unit stock drift must name stockByProduct", stock);

if (failures.length) {
  console.error(JSON.stringify({ type: "backup_drill_verify", status: "failed", failures }));
  process.exit(1);
}

console.log("");
console.log("✔ the drill detects a 1-paise and a 1-unit variance, and passes when there is none");
console.log(JSON.stringify({ type: "backup_drill_verify", status: "passed", checks: 8 }));
