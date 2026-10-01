import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("src/modules/reports/reports.routes.js", "utf8");
const controller = fs.readFileSync("src/modules/reports/reports.controller.js", "utf8");

assert.match(
  routes,
  /import \{ requireOwnerPin, requireShop \} from "\.\.\/\.\.\/middleware\/permissions\.js";/,
  "reports routes should import requireOwnerPin"
);

// Asserted by shape, not as an exact line: these routes legitimately gained an
// entitlement gate (requireContinuityAction) and would otherwise have to be edited
// here for every middleware added, which is how a guard gets quietly dropped to make
// a test pass. What must hold is that requireOwnerPin still runs BEFORE the
// controller on each one.
const protectedExportRoutes = [
  ["/export/bills", "ctrl.exportBills"],
  ["/export/stock", "ctrl.exportStock"],
  ["/export/udhar", "ctrl.exportUdhar"],
];

for (const [path, handler] of protectedExportRoutes) {
  const line = routes.split("\n").find((l) => l.trim().startsWith(`router.get("${path}"`));
  assert.ok(line, `expected a route for ${path}`);
  assert.ok(
    line.includes("requireOwnerPin"),
    `${path} should require owner role or owner PIN before export controller: ${line.trim()}`
  );
  assert.ok(
    line.indexOf("requireOwnerPin") < line.indexOf(handler),
    `${path} must run requireOwnerPin BEFORE ${handler}: ${line.trim()}`
  );
}

assert.match(
  controller,
  /DATA_EXPORTED/,
  "export controllers should audit DATA_EXPORTED after central AuditLog exists"
);

console.log("Report export permission examples passed");
