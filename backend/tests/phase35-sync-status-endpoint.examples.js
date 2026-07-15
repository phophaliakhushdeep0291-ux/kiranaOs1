import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

function mustContain(file, text, message) {
  const source = readFileSync(file, 'utf8');
  assert.ok(source.includes(text), message ?? `${file} must contain ${text}`);
}

function run() {
  mustContain('src/modules/sync/sync.routes.js', 'router.get("/status", requireDeviceActivated(), ctrl.status)', 'sync status route must exist and be device-enforced');
  mustContain('src/modules/sync/sync.routes.js', 'router.post("/retry", requireDeviceActivated(), ctrl.retry)', 'sync retry advisory route must exist');
  mustContain('src/modules/sync/sync.routes.js', 'router.get("/conflicts", requireDeviceActivated(), requireRole("owner", "admin")', 'durable conflict ledger must be restricted to management roles');
  mustContain('src/modules/sync/sync.routes.js', 'router.post("/conflicts/report", requireDeviceActivated()', 'activated devices must be able to report durable conflicts');
  mustContain('src/modules/sync/sync.routes.js', 'router.post("/resolve-conflict", requireDeviceActivated(), requireRole("owner", "admin")', 'durable conflict resolution must be restricted to management roles');
  mustContain('src/modules/sync/sync.controller.js', 'export async function status', 'sync status controller must exist');
  mustContain('src/modules/sync/sync.controller.js', 'allowed', 'sync status must return allowed state');
  mustContain('src/modules/sync/sync.controller.js', 'server_version', 'sync status must return legacy server_version for frontend compatibility');
  mustContain('src/modules/sync/sync.controller.js', 'cloudBackupAllowed', 'sync status must report cloud backup capability');
  mustContain('contracts/api-contract.v1.json', '"path": "/api/sync/status"', 'API contract must document sync status endpoint');
  mustContain('contracts/api-contract.v1.json', '"path": "/api/sync/retry"', 'API contract must document sync retry endpoint');
  mustContain('contracts/api-contract.v1.json', '"path": "/api/sync/conflicts"', 'API contract must document durable conflict listing');
  mustContain('contracts/api-contract.v1.json', '"path": "/api/sync/conflicts/report"', 'API contract must document durable conflict reporting');
  mustContain('contracts/api-contract.v1.json', '"path": "/api/sync/resolve-conflict"', 'API contract must document sync conflict endpoint');

  console.log('Phase 35 sync status endpoint examples passed');
}

run();
