import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = fileURLToPath(new URL("..", import.meta.url));

test("fresh local setup seeds a usable catalog and preserves transactional sync on repeat setup", () => {
  const prismaRoot = path.join(root, "prisma");
  const fixture = fs.mkdtempSync(path.join(prismaRoot, "local-bootstrap-test-"));
  const databaseUrl = `file:${path.join(fixture, "test.db").replaceAll("\\", "/")}`;
  const env = {
    ...process.env, NODE_ENV: "test", DATABASE_URL: databaseUrl, TEST_DATABASE_URL: databaseUrl,
    PRISMA_CLIENT_VARIANT: "", SKIP_LOCAL_PRISMA_GENERATE: "true", LOG_LEVEL: "silent",
    JWT_SECRET: "local-bootstrap-test-secret-1234567890", QUEUES_ENABLED: "false",
  };
  const run = (args) => {
    const result = spawnSync(process.execPath, args, { cwd: root, env, encoding: "utf8", timeout: 60000 });
    assert.equal(result.status, 0, `${args[0]} failed: ${result.error || ""}\n${result.stdout}\n${result.stderr}`);
  };
  try {
    run(["scripts/update-local-sqlite-schema.js"]);
    run(["prisma/seed.js"]);
    // Repeating setup must neither erase the seeded catalog nor duplicate triggers.
    run(["scripts/update-local-sqlite-schema.js"]);
    run(["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import db from './src/db.js';
      import app from './src/app.js';
      import { billPayload } from './tests/integration/factories.js';
      const server = await new Promise(resolve => {
        const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
      });
      try {
        const base = 'http://127.0.0.1:' + server.address().port;
        const login = await fetch(base + '/api/auth/login', {
          method: 'POST', headers: {'content-type':'application/json'},
          body: JSON.stringify({identifier:'9800000001',password:'demo1234',device:{deviceId:'local-bootstrap-test-device'}}),
        });
        assert.equal(login.status, 200);
        const {data: auth} = await login.json();
        const headers = {authorization: 'Bearer ' + auth.accessToken, 'content-type':'application/json', 'x-device-id':'local-bootstrap-test-device'};
        const productsResponse = await fetch(base + '/api/products?limit=350', {headers});
        assert.equal(productsResponse.status, 200, await productsResponse.clone().text());
        assert.equal(await db.product.count(), 10);
        const triggers = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'");
        assert.equal(triggers.length, 33);
        const product = await db.product.findUniqueOrThrow({where:{id:'prod-008'}});
        const billResponse = await fetch(base + '/api/bills/confirm', {
          method:'POST',headers,body:JSON.stringify(billPayload(product,{quantity:2,gstMode:'none'})),
        });
        assert.equal(billResponse.status, 201, await billResponse.clone().text());
        const {data: bill} = await billResponse.json();
        assert.equal(bill.grandTotal, 12);
        assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).stockBaseQty, 118);
        assert.equal(await db.payment.count({where:{billId:bill.id}}), 1);
        assert.ok(await db.changeLog.count({where:{entityType:'bill',entityId:bill.id}}));
        const count = await db.changeLog.count();
        await assert.rejects(db.$transaction(async tx => {
          await tx.product.update({where:{id:product.id},data:{name:'Should roll back'}});
          throw new Error('abort test transaction');
        }), /abort test transaction/);
        assert.equal(await db.changeLog.count(), count);
        assert.equal((await db.product.findUniqueOrThrow({where:{id:product.id}})).name, product.name);
      } finally {
        server.closeAllConnections();
        await new Promise(resolve => server.close(resolve));
        await db.$disconnect();
      }
    `]);
    run(["scripts/reset-local-sqlite-schema.js"]);
    run(["--input-type=module", "-e", `
      import assert from 'node:assert/strict';
      import db from './src/db.js';
      try {
        assert.equal(await db.product.count(), 0);
        const triggers = await db.$queryRawUnsafe("SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'sync_%'");
        assert.equal(triggers.length, 33);
      } finally { await db.$disconnect(); }
    `]);
  } finally {
    // Remove only this invocation's freshly allocated directory under prisma/.
    assert.equal(path.dirname(path.resolve(fixture)), path.resolve(prismaRoot));
    fs.rmSync(fixture, { recursive: true, force: true });
  }
});
