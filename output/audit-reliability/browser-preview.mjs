// Disposable QA only. Run from backend with TEST_DATABASE_URL pointing at
// prisma/audit-reliability-browser-test.db and PRISMA_CLIENT_VARIANT=integration.
import assert from 'node:assert/strict';
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
assert.ok(process.env.TEST_DATABASE_URL?.endsWith('/prisma/audit-reliability-browser-test.db'));
const { createIntegrationContext, resetDatabase } = await import('../../backend/tests/integration/setup.js');
const { createTenant } = await import('../../backend/tests/integration/factories.js');
const { createRun, executeRun } = await import('../../backend/src/modules/assurance/evaluation.service.js');
const { RULES_BY_CODE } = await import('../../backend/src/modules/assurance/rules/index.js');
const ctx = await createIntegrationContext();
await resetDatabase(ctx.db);
const { shop } = await createTenant(ctx.db, { shopName: 'Audit Reliability Demo', ownerMobile: '6999000777', password: 'AuditTest123' });
const bill = await ctx.db.bill.create({ data: { shopId: shop.id, billNo: 'QA-100', subtotal: 100, grandTotal: 100, paidAmount: 100 } });
const run = await createRun(shop.id, { runType: 'MANUAL' });
await executeRun(shop.id, run, [{ entityType: 'BILL', entityId: bill.id }], {
  rules: [{ ...RULES_BY_CODE.BILL_MARKED_PAID_WITHOUT_PAYMENTS, evaluate() { throw Error('QA: deliberately unavailable check'); } }],
});
const root = path.resolve('../frontend/dist/public');
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json', '.webmanifest': 'application/manifest+json', '.woff2': 'font/woff2' };
const server = http.createServer(async (req, res) => {
  try {
    if (req.url.startsWith('/api/')) {
      const target = new URL(req.url, ctx.baseUrl);
      const upstream = http.request(target, { method: req.method, headers: { ...req.headers, host: target.host } }, response => {
        res.writeHead(response.statusCode, response.headers); response.pipe(res);
      });
      upstream.on('error', () => { res.writeHead(502); res.end(); }); req.pipe(upstream); return;
    }
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    let file = path.resolve(root, '.' + pathname);
    if (!file.startsWith(root + '/') && file !== root) { res.writeHead(400); res.end(); return; }
    if (!path.extname(file)) file = path.join(root, 'index.html');
    const bytes = await readFile(file);
    res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream' }); res.end(bytes);
  } catch { res.writeHead(404); res.end(); }
});
server.listen(5517, '127.0.0.1', () => console.log('Audit QA preview http://127.0.0.1:5517; isolated test database; tree audit-reliability-wt'));
process.on('SIGTERM', async () => { server.close(); await ctx.close(); process.exit(0); });
process.on('SIGINT', async () => { server.close(); await ctx.close(); process.exit(0); });
