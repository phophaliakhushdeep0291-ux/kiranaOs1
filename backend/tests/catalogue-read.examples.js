import assert from "node:assert/strict";
import { createCatalogueReader } from "../src/modules/products/catalogue-read.js";
import { apiJsonReplacer } from "../src/utils/json.js";

const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
let revision = 1n;
const queries = [];
const client = {
  changeLog: { findFirst: async () => ({ seq: revision }) },
  product: { findMany: (query) => { const wait = deferred(); queries.push({ query, ...wait }); return wait.promise; } },
};
const read = createCatalogueReader(client, { engine: "sqlite" });
const where = { shopId: "a", deletedAt: null };
const first = read(where), second = read(where);
await tick();
assert.equal(queries.length, 1, "identical concurrent reads share one database query");
const original = [{ id: "one", costPaise: 123n, updatedAt: new Date(), sellingUnits: [{ price: 1 }] }];
queries[0].resolve(original);
const [a, b] = await Promise.all([first, second]);
a[0].sellingUnits[0].price = 99;
assert.equal(b[0].sellingUnits[0].price, 1);
assert.equal(b[0].costPaise, 123n);
assert.ok(b[0].updatedAt instanceof Date);

const fresh = read(where);
await tick();
assert.equal(queries.length, 2, "completed values are never cached");
revision++;
const changed = read(where);
const otherShop = read({ ...where, shopId: "b" });
const search = read({ ...where, OR: [{ name: { contains: "rice" } }] });
await tick();
assert.equal(queries.length, 5, "new revision, other shop and search cannot join an old read");
queries[1].resolve([{ stock: 10 }]);
queries[2].resolve([{ stock: 8 }]);
queries[3].resolve([{ stock: 6 }]);
queries[4].resolve([]);
assert.deepEqual(await Promise.all([fresh, changed, otherShop, search]), [[{ stock: 10 }], [{ stock: 8 }], [{ stock: 6 }], []]);

const failed = read(where), alsoFailed = read(where);
const failures = Promise.allSettled([failed, alsoFailed]);
await tick();
queries[5].reject(new Error("database unavailable"));
assert.ok((await failures).every(result => result.status === "rejected"));
const retry = read(where);
await tick();
assert.equal(queries.length, 7, "failed reads are evicted");
queries[6].resolve([]);
await retry;
let serializations = 0;
const readJson = createCatalogueReader(client, { engine: "sqlite", project: rows => { serializations++; return JSON.stringify(rows, apiJsonReplacer); }, copy: value => value });
const jsonA = readJson(where), jsonB = readJson(where);
await tick();
queries[7].resolve([{ small: 123n, large: 9007199254740993n }]);
assert.deepEqual(await Promise.all([jsonA, jsonB]), ['[{"small":123,"large":"9007199254740993"}]', '[{"small":123,"large":"9007199254740993"}]']);
assert.equal(serializations, 1, "concurrent JSON responses serialize once");
console.log("Catalogue read sharing passed: concurrent reads, fresh writes, tenant/filter isolation, nested values and failure recovery.");
