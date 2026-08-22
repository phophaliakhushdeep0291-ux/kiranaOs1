/**
 * Capture-on-first-scan — barcode binding.
 *
 * The catalog learns barcodes by being used: an unknown code at the till opens a sheet,
 * the cashier picks the item, and the code binds to it. The starter catalog ships every
 * barcode blank on purpose (a real EAN-13 for a specific SKU cannot be invented, and a
 * wrong one silently bills the wrong item), so this is the path by which real codes
 * arrive — which makes its rules money-critical rather than cosmetic.
 *
 * These run the real service against an in-memory Prisma double, so the decisions being
 * asserted are the ones production takes. The database's own unique index is proven
 * separately in tests/integration/barcode-binding.integration.test.js.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { bindProductBarcode } from '../src/modules/products/products.service.js';
import {
  OWNER_SYNC_EVENT_TYPES,
  SYNC_EVENT_TYPES,
  classifySyncError,
  isSupportedSyncEventType,
} from '../src/utils/syncRules.js';

const SHOP = 'shop-1';

/**
 * A Prisma double narrow enough to be honest: it implements only the queries the service
 * actually issues, and it applies the same WHERE semantics (shop scoping, NOT-self,
 * barcode-OR-sku) rather than returning canned answers.
 */
function fakeClient({ products = [], sellingUnits = [], onUpdate = null } = {}) {
  const state = {
    products: products.map((row) => ({ sku: null, barcode: null, deletedAt: null, aliasesJson: '[]', ...row })),
    sellingUnits: sellingUnits.map((row) => ({ ...row })),
    audits: [],
    updates: [],
  };

  const matchesProduct = (row, where) => {
    if (where.shopId && row.shopId !== where.shopId) return false;
    if (where.id && row.id !== where.id) return false;
    if (where.NOT?.id && row.id === where.NOT.id) return false;
    if (where.deletedAt === null && row.deletedAt !== null) return false;
    if (Array.isArray(where.OR)) {
      return where.OR.some((clause) =>
        Object.entries(clause).every(([field, value]) => row[field] === value));
    }
    return true;
  };

  return {
    state,
    product: {
      findFirst: async ({ where, include }) => {
        const row = state.products.find((candidate) => matchesProduct(candidate, where)) ?? null;
        if (!row || !include?.sellingUnits) return row;
        return { ...row, sellingUnits: state.sellingUnits.filter((unit) => unit.productId === row.id) };
      },
      findMany: async ({ where }) => state.products.filter((row) => matchesProduct(row, where)),
      update: async ({ where, data }) => {
        state.updates.push({ where, data });
        if (onUpdate) await onUpdate({ where, data, state });
        const row = state.products.find((item) => item.id === where.id);
        Object.assign(row, data);
        return row;
      },
    },
    productSellingUnit: {
      findFirst: async ({ where }) => state.sellingUnits.find((row) => {
        if (where.shopId && row.shopId !== where.shopId) return false;
        if (where.NOT?.productId && row.productId === where.NOT.productId) return false;
        return row.barcode === where.barcode;
      }) ?? null,
      findMany: async ({ where }) => state.sellingUnits.filter((row) => {
        if (where.shopId && row.shopId !== where.shopId) return false;
        if (where.NOT?.productId && row.productId === where.NOT.productId) return false;
        return true;
      }),
    },
    auditLog: {
      create: async ({ data }) => {
        state.audits.push(data);
        return data;
      },
    },
  };
}

async function expectRejection(promise, code, message) {
  try {
    await promise;
  } catch (error) {
    assert.equal(error.code, code, `${message}: expected ${code}, got ${error.code} (${error.message})`);
    assert.equal(error.statusCode ?? error.status, 409, `${message}: must be a 409 so the outbox treats it as a conflict`);
    return error;
  }
  assert.fail(`${message}: expected a rejection, the bind was allowed`);
}

async function run() {
  /* ── A free code binds, and the audit trail records who and on which device ── */
  {
    const client = fakeClient({ products: [{ id: 'p1', shopId: SHOP, name: 'Parle-G' }] });
    const product = await bindProductBarcode(SHOP, 'p1', ' 8901234567890 ', {
      client,
      userId: 'user-9',
      identity: { sourceDeviceId: 'till-2', clientProductId: 'local-p1' },
    });

    assert.equal(product.barcode, '8901234567890', 'the code is stored trimmed');
    assert.equal(product.sku, '8901234567890', 'an empty sku mirrors the barcode so either column resolves a scan');
    assert.equal(client.state.audits.length, 1, 'every bind is auditable');
    const audit = client.state.audits[0];
    assert.equal(audit.action, 'product_barcode_bound');
    assert.equal(audit.userId, 'user-9', 'the audit row names the user');
    assert.equal(audit.deviceId, 'till-2', 'a bind that arrived over sync still names its device');
    assert.equal(audit.entityId, 'p1');
  }

  /* ── An sku the shop already set is never overwritten by a scan ── */
  {
    const client = fakeClient({ products: [{ id: 'p1', shopId: SHOP, name: 'Parle-G', sku: 'PG-100' }] });
    const product = await bindProductBarcode(SHOP, 'p1', '8901234567890', { client });
    assert.equal(product.barcode, '8901234567890');
    assert.equal(product.sku, 'PG-100', 'the shop\'s own sku survives the bind');
  }

  /* ── REQUIRED: a duplicate barcode across two products is rejected at the service ──
     A code pointing at two products bills whichever row the query returned first. That
     is silent, and it is money. */
  {
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'p2', shopId: SHOP, name: 'Good Day', barcode: '8901234567890' },
      ],
    });
    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a code owned by another product',
    );
    assert.match(error.message, /Good Day/, 'the cashier is told which product owns the code');
    assert.equal(client.state.updates.length, 0, 'nothing was written');
  }

  /* ── The same guard covers the sku column, which a scan also resolves against ── */
  {
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'p2', shopId: SHOP, name: 'Good Day', sku: '8901234567890' },
      ],
    });
    await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a code sitting in another product\'s sku',
    );
  }

  /* ── …and per-pack codes, which live on the selling unit ── */
  {
    const client = fakeClient({
      products: [{ id: 'p1', shopId: SHOP, name: 'Atta 5kg' }],
      sellingUnits: [{ productId: 'p2', shopId: SHOP, barcode: '8901234567890', unitCode: 'bag-10kg', product: { name: 'Atta 10kg' } }],
    });
    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a code owned by another product\'s pack',
    );
    assert.match(error.message, /bag-10kg/, 'the message names the pack that owns it');
  }

  /* ── Scan matching is case-insensitive, so uniqueness must be too ── */
  {
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'p2', shopId: SHOP, name: 'Good Day', sku: 'case-128-abc' },
      ],
    });
    await expectRejection(
      bindProductBarcode(SHOP, 'p1', 'CASE-128-ABC', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a differently-cased code that resolves to another product',
    );
  }

  /* ── A product cannot reuse one code for two of its own physical packs ── */
  {
    const client = fakeClient({
      products: [{ id: 'p1', shopId: SHOP, name: 'Atta' }],
      sellingUnits: [{ productId: 'p1', shopId: SHOP, barcode: '8901234567890', unitCode: 'bag-10kg', isDefault: false }],
    });
    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'one code assigned to both the default product and its alternate pack',
    );
    assert.match(error.message, /bag-10kg/, 'the owner is told which pack conflicts');
  }

  /* ── A product in the recycle bin keeps its code reserved: restoring it would
        otherwise create a true duplicate ── */
  {
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'p2', shopId: SHOP, name: 'Old Biscuit', barcode: '8901234567890', deletedAt: new Date() },
      ],
    });
    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a code held by a deleted product',
    );
    assert.match(error.message, /recycle bin/i, 'the owner is told where to find the product holding it');
  }

  /* ── Another shop's identical code is irrelevant: uniqueness is per shop ── */
  {
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'x1', shopId: 'other-shop', name: 'Someone else\'s biscuit', barcode: '8901234567890' },
      ],
    });
    const product = await bindProductBarcode(SHOP, 'p1', '8901234567890', { client });
    assert.equal(product.barcode, '8901234567890', 'a neighbouring shop cannot block this shop\'s bind');
  }

  /* ── Never rebind. A cashier scanning the wrong packet mid-queue must not be able to
        repoint a code that already resolves somewhere. ── */
  {
    const client = fakeClient({ products: [{ id: 'p1', shopId: SHOP, name: 'Parle-G', barcode: '8900000000001' }] });
    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_ALREADY_SET',
      'a product that already has a code',
    );
    assert.match(error.message, /product screen/, 'rebinding is redirected to the explicit edit action');
    assert.equal(client.state.updates.length, 0, 'the existing code is untouched');
  }

  /* ── REQUIRED: replay is exactly once. An offline bind is retried whenever a push
        fails; re-binding the same code must succeed without writing again. ── */
  {
    const client = fakeClient({ products: [{ id: 'p1', shopId: SHOP, name: 'Parle-G' }] });
    const first = await bindProductBarcode(SHOP, 'p1', '8901234567890', { client });
    const replay = await bindProductBarcode(SHOP, 'p1', '8901234567890', { client });

    assert.equal(first.barcode, '8901234567890');
    assert.equal(replay.barcode, '8901234567890', 'the replay reports the same bound state');
    assert.equal(client.state.updates.length, 1, 'the replay must not write a second time');
    assert.equal(client.state.audits.length, 1, 'nor log a second bind');
  }

  /* ── REQUIRED: concurrent binds from two devices resolve without data loss.
        Both devices read a free code, then race at the unique index. Exactly one wins;
        the loser is told, and nothing it owns is overwritten. ── */
  {
    // Device B's write lands between A's read and A's write. Prisma then rejects A.
    const client = fakeClient({
      products: [
        { id: 'p1', shopId: SHOP, name: 'Parle-G' },
        { id: 'p2', shopId: SHOP, name: 'Good Day' },
      ],
      onUpdate: async ({ where, state }) => {
        if (where.id !== 'p1') return;
        const winner = state.products.find((row) => row.id === 'p2');
        winner.barcode = '8901234567890';
        const conflict = new Error('Unique constraint failed on the fields: (`shopId`,`barcode`)');
        conflict.code = 'P2002';
        throw conflict;
      },
    });

    const error = await expectRejection(
      bindProductBarcode(SHOP, 'p1', '8901234567890', { client }),
      'PRODUCT_BARCODE_DUPLICATE',
      'a bind that lost the race at the database',
    );
    assert.match(error.message, /just bound/, 'the loser is told the code was taken, not shown a 500');

    const loser = client.state.products.find((row) => row.id === 'p1');
    const winner = client.state.products.find((row) => row.id === 'p2');
    assert.equal(winner.barcode, '8901234567890', 'the winner keeps the code');
    assert.equal(loser.barcode, null, 'the loser is left exactly as it was — no half-write');
    assert.equal(loser.name, 'Parle-G', 'and no other field was touched');
    assert.equal(client.state.audits.length, 0, 'a failed bind writes no audit row');

    // The loser is a conflict the owner can see, not an infinite retry.
    const classified = classifySyncError(error);
    assert.equal(classified.resultStatus, 'conflict', 'a lost race surfaces through the existing conflict path');
    assert.equal(classified.retryable, false, 'retrying it unchanged could never succeed');
    assert.equal(classified.code, 'PRODUCT_BARCODE_DUPLICATE', 'the owner is told what to fix');
  }

  /* ── An empty code is refused before anything is read ── */
  {
    const client = fakeClient({ products: [{ id: 'p1', shopId: SHOP, name: 'Parle-G' }] });
    await assert.rejects(
      bindProductBarcode(SHOP, 'p1', '   ', { client }),
      (error) => error.code === 'PRODUCT_BARCODE_REQUIRED',
      'a blank code is not a barcode',
    );
    assert.equal(client.state.updates.length, 0);
  }

  /* ── A missing product is a 404, not a silent no-op ── */
  {
    const client = fakeClient({ products: [] });
    await assert.rejects(
      bindProductBarcode(SHOP, 'ghost', '8901234567890', { client }),
      /Product not found/,
    );
  }

  /* ── Sync wiring: the bind travels as its own event, and is not owner-gated ── */
  {
    assert.equal(SYNC_EVENT_TYPES.BIND_PRODUCT_BARCODE, 'BIND_PRODUCT_BARCODE', 'the event type must be declared');
    assert.equal(isSupportedSyncEventType('BIND_PRODUCT_BARCODE'), true, 'push must accept it');
    assert.equal(
      OWNER_SYNC_EVENT_TYPES.has('BIND_PRODUCT_BARCODE'),
      false,
      'a cashier mid-queue must be able to teach a barcode without the owner PIN',
    );

    const syncSource = readFileSync('src/modules/sync/sync.service.js', 'utf8');
    assert.ok(
      syncSource.includes('case SYNC_EVENT_TYPES.BIND_PRODUCT_BARCODE'),
      'sync.service.js must handle the event',
    );
    assert.ok(
      syncSource.includes('bindProductBarcode(shopId, productId, payload.barcode'),
      'the sync path must go through the same service as the HTTP route, so the two cannot drift',
    );

    const routeSource = readFileSync('src/modules/products/products.routes.js', 'utf8');
    assert.ok(
      routeSource.includes('validate(bindProductBarcodeSchema)'),
      'the HTTP route must accept only a barcode, never a partial product',
    );

    const docs = readFileSync('docs/SYNC.md', 'utf8');
    assert.ok(docs.includes('BIND_PRODUCT_BARCODE'), 'the event belongs in the sync docs');
    assert.ok(docs.includes('Conflict matrix'), 'its race outcomes belong in the conflict matrix');
  }

  console.log('Barcode binding examples passed');
}

await run();
