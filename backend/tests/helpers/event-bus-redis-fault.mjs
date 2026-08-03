// Fault path for the Redis event-bus proof. Separate process so ioredis
// connects to a broker that rejects XADD from its first command.
// Driven by tests/event-bus-redis.examples.js.
import net from "node:net";

const ok = (label, cond, extra = "") =>
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
let failures = 0;
const check = (label, cond, extra) => { if (!cond) failures++; ok(label, cond, extra); };

function parseCommand(buf) {
  if (buf.length === 0 || buf[0] !== 0x2a) return null;
  const i = buf.indexOf("\r\n");
  if (i < 0) return null;
  const count = parseInt(buf.subarray(1, i).toString(), 10);
  let off = i + 2;
  const args = [];
  for (let n = 0; n < count; n += 1) {
    if (buf[off] !== 0x24) return null;
    const j = buf.indexOf("\r\n", off);
    if (j < 0) return null;
    const len = parseInt(buf.subarray(off + 1, j).toString(), 10);
    const start = j + 2;
    if (buf.length < start + len + 2) return null;
    args.push(buf.subarray(start, start + len).toString());
    off = start + len + 2;
  }
  return { args, consumed: off };
}

// A broker that accepts the connection but rejects every XADD.
const server = net.createServer((socket) => {
  let buf = Buffer.alloc(0);
  socket.on("data", (chunk) => {
    buf = Buffer.concat([buf, chunk]);
    for (;;) {
      const parsed = parseCommand(buf);
      if (!parsed) break;
      buf = buf.subarray(parsed.consumed);
      const name = String(parsed.args[0]).toUpperCase();
      if (name === "XADD") socket.write("-ERR OOM command not allowed when used memory > 'maxmemory'\r\n");
      else if (name === "PING") socket.write("+PONG\r\n");
      else socket.write("+OK\r\n");
    }
  });
  socket.on("error", () => {});
});
const port = await new Promise((res) => server.listen(0, "127.0.0.1", () => res(server.address().port)));

process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
process.env.EVENT_BUS_PROVIDER = "redis";
process.env.QUEUES_ENABLED = "true";

const bus = await import("../../src/lib/eventBus.js");

console.log("\nBroker rejects every XADD (simulated OOM):");
let threw = null;
let res = null;
const started = Date.now();
try {
  res = await bus.publishEvent(bus.EVENT_TOPICS.DEVICE_HEALTH, "shop-42", { battery: 12 });
} catch (e) { threw = e; }

check("a rejecting broker never throws into the caller", threw === null,
  threw ? `(threw ${threw.message})` : "");
check("the failure is reported, not silently swallowed",
  res && res.published === false, `(published=${res?.published})`);
check("the reason is explicit", res?.reason === "PUBLISH_FAILED", `(${res?.reason})`);
check("it fails fast rather than hanging", Date.now() - started < 5000,
  `(${Date.now() - started}ms)`);

const status = bus.getEventBusStatus();
check("failures are counted for the admin dashboard", status.failed === 1, `(failed=${status.failed})`);
check("the broker's error message is retained for operators",
  /OOM|maxmemory/i.test(status.lastError ?? ""), `(lastError: ${String(status.lastError).slice(0, 50)})`);
check("nothing is wrongly counted as published", status.published === 0, `(published=${status.published})`);

// The business flow that emits the event must be unaffected.
let flowCompleted = false;
await (async () => {
  bus.publishEvent(bus.EVENT_TOPICS.ERROR_RECORDED, "shop-42", { title: "x" }).catch(() => {});
  flowCompleted = true;              // fire-and-forget: never awaited by callers
})();
check("fire-and-forget callers are not blocked by a dead broker", flowCompleted === true);

server.close();
console.log(`\n${failures === 0 ? "FAULT CHECKS PASSED" : `${failures} FAULT CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
