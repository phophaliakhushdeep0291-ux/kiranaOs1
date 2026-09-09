import assert from "node:assert/strict";
import http from "node:http";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const fromLoadtest = createRequire(require.resolve("autocannon"));
const fromHyperid = createRequire(fromLoadtest.resolve("hyperid"));
const uuid = fromHyperid("uuid");
assert.equal(fromHyperid("uuid/package.json").version, "11.1.1", "use the patched CommonJS-compatible UUID release");
assert.ok(uuid.validate(uuid.v4()), "hyperid's fallback UUID API must remain supported");
for (const algorithm of ["v3", "v5"]) {
  assert.throws(() => uuid[algorithm]("test", uuid[algorithm].DNS, new Uint8Array(8), 4), RangeError);
}
assert.throws(() => uuid.v6({}, new Uint8Array(8), 4), RangeError);
const generate = fromLoadtest("hyperid")({ urlSafe: true, maxInt: 5 });
const ids = Array.from({ length: 20 }, () => generate());
assert.equal(new Set(ids).size, ids.length, "identifier rollover must remain unique");
assert.ok(ids.every((id) => /^[A-Za-z0-9_-]+$/.test(id)));

// Exercise the real load generator against an owned loopback-only HTTP fixture,
// never a merchant API or an existing development server.
let requests = 0;
const server = http.createServer((request, response) => {
  requests++;
  response.writeHead(request.url === "/compat" ? 200 : 404, { "content-type": "text/plain" });
  response.end("ok");
});
await new Promise((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", resolve); });
try {
  const result = await new Promise((resolve, reject) => require("autocannon")({
    url: `http://127.0.0.1:${server.address().port}/compat`, connections: 1, amount: 20, timeout: 2,
  }, (error, value) => error ? reject(error) : resolve(value)));
  assert.equal(result.errors, 0);
  assert.equal(result.non2xx, 0);
  assert.equal(result.requests.total, 20);
  assert.equal(requests, 20);
} finally {
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}
console.log("Load-test dependency compatibility passed: patched UUID bounds, CommonJS API, unique rollover and 20 local HTTP requests");
