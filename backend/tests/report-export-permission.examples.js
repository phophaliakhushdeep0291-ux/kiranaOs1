import assert from "node:assert/strict";
import fs from "node:fs";

const routes = fs.readFileSync("src/modules/reports/reports.routes.js", "utf8");
const controller = fs.readFileSync("src/modules/reports/reports.controller.js", "utf8");

assert.match(
  routes,
  /import \{ requireOwnerPin, requireShop \} from "\.\.\/\.\.\/middleware\/permissions\.js";/,
  "reports routes should import requireOwnerPin"
);

const protectedExportRoutes = [
  'router.get("/export/bills", requireOwnerPin, ctrl.exportBills);',
  'router.get("/export/stock", requireOwnerPin, ctrl.exportStock);',
  'router.get("/export/udhar", requireOwnerPin, ctrl.exportUdhar);',
];

for (const expectedLine of protectedExportRoutes) {
  assert.ok(
    routes.includes(expectedLine),
    `${expectedLine} should require owner role or owner PIN before export controller`
  );
}

assert.match(
  controller,
  /DATA_EXPORTED/,
  "export controllers should audit DATA_EXPORTED after central AuditLog exists"
);

console.log("Report export permission examples passed");
