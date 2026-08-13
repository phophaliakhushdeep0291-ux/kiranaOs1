import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { normalizeTallyUrl, parseTallyResponse, tallyFailureMessage } from "../src/tally-gateway.mjs";

// Pushing vouchers into a live TallyPrime is the one bridge operation that
// writes to something outside this shop's own machine state, and Tally will not
// warn anybody about a mistake. So the properties guarded here are the ones that
// decide whether the app is allowed to believe the books are up to date.

/* ── The address is ours, not the caller's ────────────────────────────────── */

assertThrows(() => normalizeTallyUrl("http://books.example.com:9000"), /same computer/);
assertThrows(() => normalizeTallyUrl("https://127.0.0.1:9000"), /plain HTTP/);
assertThrows(() => normalizeTallyUrl("not a url"), /valid URL/);
assert.equal(normalizeTallyUrl(""), null, "no address configured means the shop does not use Tally");
assert.deepEqual(normalizeTallyUrl("http://127.0.0.1:9000"), { hostname: "127.0.0.1", port: 9000, path: "/" });
assert.equal(normalizeTallyUrl("http://localhost").port, 9000, "Tally's gateway port is the default");

function assertThrows(fn, pattern) {
  assert.throws(fn, pattern);
}

/* ── Reading Tally's reply ────────────────────────────────────────────────── */

test("a 200 from Tally is not the same as an import that worked", () => {
  const created = parseTallyResponse("<RESPONSE><CREATED>4</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>");
  assert.equal(created.ok, true);
  assert.equal(created.created, 4);

  // Tally answers HTTP 200 here too. Treating the status as the outcome would
  // tell a shopkeeper their month is filed when Tally took none of it.
  const rejected = parseTallyResponse("<RESPONSE><CREATED>0</CREATED><ERRORS>3</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>");
  assert.equal(rejected.ok, false, "reported errors must not read as success");
  assert.equal(rejected.errors, 3);

  const lineError = parseTallyResponse("<RESPONSE><CREATED>2</CREATED><ERRORS>0</ERRORS><LINEERROR>Ledger 'Sharma &amp; Sons' does not exist</LINEERROR></RESPONSE>");
  assert.equal(lineError.ok, false, "a partial import is not a success");
  assert.match(tallyFailureMessage(lineError, ""), /does not exist/);

  // The classic Tally misconfiguration: the gateway is on but no company is
  // open, so it answers with a page rather than an import result.
  const noCompany = parseTallyResponse("<html><body>There is no company open</body></html>");
  assert.equal(noCompany.ok, false, "a non-import reply must never read as success");
  assert.match(tallyFailureMessage(noCompany, "There is no company open"), /company is open/);

  // An empty 200 is the same trap without the hint.
  assert.equal(parseTallyResponse("").ok, false, "an empty reply is not an import");
});

test("an ignored Tally object fails closed because it may be a voucher", () => {
  const result = parseTallyResponse("<RESPONSE><CREATED>2</CREATED><ALTERED>0</ALTERED><IGNORED>1</IGNORED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>");
  assert.equal(result.ok, false);
  assert.match(tallyFailureMessage(result, ""), /ignored 1 object/);
});

/* ── The whole path, against a stub Tally ─────────────────────────────────── */

async function startStubTally(handler) {
  const received = [];
  const server = http.createServer((req, res) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => {
      received.push({ body: Buffer.concat(chunks).toString("utf8"), contentType: req.headers["content-type"], method: req.method });
      handler(res, received.length);
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { port: server.address().port, received, close: () => new Promise((resolve) => server.close(resolve)) };
}

async function startBridge(context, { tallyUrl }) {
  const port = 19_000 + Math.floor(Math.random() * 900);
  const token = "test-pairing-token-123456789-abcdef";
  const directory = await mkdtemp(path.join(os.tmpdir(), "kiranaos-tally-test-"));
  const child = spawn(process.execPath, ["src/server.mjs"], {
    cwd: new URL("..", import.meta.url),
    env: {
      ...process.env,
      KIRANA_BRIDGE_PORT: String(port),
      KIRANA_BRIDGE_TOKEN: token,
      KIRANA_BRIDGE_ALLOWED_ORIGINS: "https://pos.example.test",
      KIRANA_BRIDGE_CONFIG: path.join(directory, "missing-config.json"),
      KIRANA_BRIDGE_JOB_JOURNAL: path.join(directory, "jobs.json"),
      ...(tallyUrl ? { KIRANA_BRIDGE_TALLY_URL: tallyUrl } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  context.after(async () => { child.kill(); await rm(directory, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Bridge did not start")), 5_000);
    child.stdout.on("data", (chunk) => { if (String(chunk).includes("listening")) { clearTimeout(timer); resolve(); } });
    child.once("exit", (code) => { clearTimeout(timer); reject(new Error(`Bridge exited early (${code})`)); });
  });
  return {
    base: `http://127.0.0.1:${port}`,
    headers: { origin: "https://pos.example.test", authorization: `Bearer ${token}`, "content-type": "application/json" },
  };
}

const ENVELOPE = '<?xml version="1.0" encoding="UTF-8"?><ENVELOPE><HEADER><TALLYREQUEST>Import Data</TALLYREQUEST></HEADER><BODY/></ENVELOPE>';

test("an envelope reaches Tally and its verdict decides the bridge's answer", async (context) => {
  const tally = await startStubTally((res, callNumber) => {
    res.writeHead(200, { "content-type": "text/xml" });
    res.end(callNumber === 1
      ? "<RESPONSE><CREATED>2</CREATED><ALTERED>0</ALTERED><ERRORS>0</ERRORS><EXCEPTIONS>0</EXCEPTIONS></RESPONSE>"
      : "<RESPONSE><CREATED>0</CREATED><ERRORS>1</ERRORS><LINEERROR>Voucher totals do not match</LINEERROR></RESPONSE>");
  });
  context.after(() => tally.close());
  const { base, headers } = await startBridge(context, { tallyUrl: `http://127.0.0.1:${tally.port}` });

  assert.equal((await (await fetch(`${base}/v1/health`, { headers })).json()).capabilities.tally, true, "a configured Tally is advertised");

  const good = await fetch(`${base}/v1/tally/post`, { method: "POST", headers, body: JSON.stringify({ xml: ENVELOPE }) });
  assert.equal(good.status, 200);
  assert.deepEqual(await good.json().then((b) => ({ ok: b.ok, created: b.created })), { ok: true, created: 2 });

  // The envelope must arrive byte-identical: this is the same document that
  // imports as a file, and Tally is unforgiving about the declared encoding.
  assert.equal(tally.received[0].body, ENVELOPE, "the envelope reaches Tally unmodified");
  assert.match(tally.received[0].contentType, /charset=utf-8/, "the header must agree with the XML prologue");

  // Tally's second answer rejects the import while still returning HTTP 200.
  const bad = await fetch(`${base}/v1/tally/post`, { method: "POST", headers, body: JSON.stringify({ xml: ENVELOPE }) });
  assert.equal(bad.status, 422, "a rejected import must not answer 200, or the app records it as sent");
  const body = await bad.json();
  assert.equal(body.ok, false);
  assert.match(body.message, /totals do not match/);
});

test("a body that is not an import envelope never reaches Tally", async (context) => {
  const tally = await startStubTally((res) => { res.writeHead(200); res.end("<RESPONSE><CREATED>1</CREATED></RESPONSE>"); });
  context.after(() => tally.close());
  const { base, headers } = await startBridge(context, { tallyUrl: `http://127.0.0.1:${tally.port}` });

  for (const xml of ["", "   ", "<html><body>hello</body></html>", '{"not":"xml"}']) {
    const response = await fetch(`${base}/v1/tally/post`, { method: "POST", headers, body: JSON.stringify({ xml }) });
    assert.equal(response.status, 400, `refused before dialling Tally: ${JSON.stringify(xml)}`);
  }
  assert.equal(tally.received.length, 0, "nothing junk was forwarded");
});

test("a shop with Tally closed is told what to do about it", async (context) => {
  // Nothing is listening on this port, which is exactly what a closed Tally
  // looks like from here.
  const { base, headers } = await startBridge(context, { tallyUrl: "http://127.0.0.1:9" });
  const response = await fetch(`${base}/v1/tally/post`, { method: "POST", headers, body: JSON.stringify({ xml: ENVELOPE }) });
  assert.equal(response.status, 503);
  const { message } = await response.json();
  assert.match(message, /Open Tally/, "the message names the fix, not the socket error");
  assert.doesNotMatch(message, /ECONNREFUSED/, "a shopkeeper cannot act on an errno");
});

test("a counter with no Tally configured says so instead of failing obscurely", async (context) => {
  const { base, headers } = await startBridge(context, { tallyUrl: null });
  assert.equal((await (await fetch(`${base}/v1/health`, { headers })).json()).capabilities.tally, false);
  const response = await fetch(`${base}/v1/tally/post`, { method: "POST", headers, body: JSON.stringify({ xml: ENVELOPE }) });
  assert.equal(response.status, 503);
  assert.match((await response.json()).message, /not set up to send to Tally/);
});

test("the Tally endpoint is behind the same pairing gate as every other route", async (context) => {
  const tally = await startStubTally((res) => { res.writeHead(200); res.end("<RESPONSE><CREATED>1</CREATED></RESPONSE>"); });
  context.after(() => tally.close());
  const { base, headers } = await startBridge(context, { tallyUrl: `http://127.0.0.1:${tally.port}` });

  const noToken = await fetch(`${base}/v1/tally/post`, {
    method: "POST",
    headers: { origin: "https://pos.example.test", "content-type": "application/json" },
    body: JSON.stringify({ xml: ENVELOPE }),
  });
  assert.equal(noToken.status, 401);

  const wrongOrigin = await fetch(`${base}/v1/tally/post`, {
    method: "POST",
    headers: { ...headers, origin: "https://evil.example" },
    body: JSON.stringify({ xml: ENVELOPE }),
  });
  assert.equal(wrongOrigin.status, 403);
  assert.equal(tally.received.length, 0, "an unpaired caller never reaches the books");
});
