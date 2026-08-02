// Publish path for the Redis event-bus proof. Separate process because
// config/env.js parses process.env once at import. Driven by tests/event-bus-redis.examples.js.
import net from "node:net";

const ok = (label, cond, extra = "") =>
  console.log(`  ${cond ? "PASS" : "FAIL"}  ${label}${extra ? `  ${extra}` : ""}`);
let failures = 0;
const check = (label, cond, extra) => { if (!cond) failures++; ok(label, cond, extra); };

function startRedisLike({ failXadd = false } = {}) {
  const received = [];
  let seq = 0;
  const server = net.createServer((socket) => {
    let buf = Buffer.alloc(0);
    socket.on("data", (chunk) => {
      buf = Buffer.concat([buf, chunk]);
      for (;;) {
        const parsed = parseCommand(buf);
        if (!parsed) break;
        buf = buf.subarray(parsed.consumed);
        const [cmd, ...args] = parsed.args;
        const name = String(cmd).toUpperCase();
        received.push([name, ...args]);
        if (name === "XADD") {
          if (failXadd) { socket.write("-ERR simulated redis failure\r\n"); continue; }
          const id = `${Date.now()}-${seq++}`;
          socket.write(`$${Buffer.byteLength(id)}\r\n${id}\r\n`);
        } else if (name === "PING") socket.write("+PONG\r\n");
        else if (name === "QUIT") { socket.write("+OK\r\n"); socket.end(); }
        else socket.write("+OK\r\n");
      }
    });
    socket.on("error", () => {});
  });
  return { server, received };
}

function parseCommand(buf) {
  if (buf.length === 0 || buf[0] !== 0x2a) return null;
  let i = buf.indexOf("\r\n");
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

const listen = (s) => new Promise((res) => s.listen(0, "127.0.0.1", () => res(s.address().port)));

const { server, received } = startRedisLike();
const port = await listen(server);
process.env.REDIS_URL = `redis://127.0.0.1:${port}`;
process.env.EVENT_BUS_PROVIDER = "redis";
process.env.QUEUES_ENABLED = "false";  // proves the bus no longer depends on job queues
process.env.APP_VERSION = "9.9.9-proof";

const bus = await import("../../src/lib/eventBus.js");

console.log("\nPublishing over a real socket with the real ioredis client:");
check("provider resolves to redis", bus.getEventBusProvider() === "redis");
check("isEventBusEnabled() is true", bus.isEventBusEnabled() === true);

const res = await bus.publishEvent(
  bus.EVENT_TOPICS.SYNC_FAILED,
  "shop-42",
  { failed: 3, explanation: "Updating a product failed because the product no longer exists" },
  { deviceId: "device-01" },
);
check("publishEvent reports published", res.published === true, `(id ${res.id})`);
check("the server returned a stream id", typeof res.id === "string" && /^\d+-\d+$/.test(res.id ?? ""));

// ── The exact wire command ───────────────────────────────────────────────────
const xadd = received.find((r) => r[0] === "XADD");
console.log("\nWire command actually sent:");
console.log("  XADD " + xadd.slice(1).map((a) => (a.length > 60 ? a.slice(0, 57) + "..." : a)).join(" "));
check("command is XADD", !!xadd);
check("stream key is the topic", xadd[1] === "artha.sync.failed", `(${xadd[1]})`);
check("MAXLEN ~ 10000 trimming is applied",
  xadd[2] === "MAXLEN" && xadd[3] === "~" && xadd[4] === "10000",
  `(${xadd[2]} ${xadd[3]} ${xadd[4]})`);
check("server generates the id (*)", xadd[5] === "*");

const fields = {};
for (let i = 6; i < xadd.length; i += 2) fields[xadd[i]] = xadd[i + 1];
check("partition key field is the shopId", fields.key === "shop-42", `(key=${fields.key})`);
const value = JSON.parse(fields.value);
check("payload round-trips as the record value", value.failed === 3);
check("plain-language explanation survives", /no longer exists/.test(value.explanation));
const headers = JSON.parse(fields.headers);
check("caller headers preserved", headers.deviceId === "device-01");
check("provenance header set", headers.source === "artha-backend");
check("version header read from APP_VERSION", headers.version === "9.9.9-proof", `(${headers.version})`);
check("unique event id present", /^evt_[0-9a-f]{32}$/.test(headers.eventId ?? ""));
check("timestamp field sent", /^\d{13}$/.test(fields.ts ?? ""));

// ── Ordering: one shop's events stay on one partition key ────────────────────
await bus.publishEvent(bus.EVENT_TOPICS.SYNC_COMPLETED, "shop-42", { applied: 5 });
await bus.publishEvent(bus.EVENT_TOPICS.ERROR_RECORDED, "shop-99", { title: "boom" });
const xadds = received.filter((r) => r[0] === "XADD");
const keyFor = (r) => r[r.indexOf("key") + 1];
check("a shop's events share one partition key",
  keyFor(xadds[0]) === "shop-42" && keyFor(xadds[1]) === "shop-42");
check("a different shop gets a different key", keyFor(xadds[2]) === "shop-99");
check("each topic is its own stream",
  xadds[1][1] === "artha.sync.completed" && xadds[2][1] === "artha.diagnostics.error");

const status = bus.getEventBusStatus();
check("status counts the publishes", status.published === 3, `(published=${status.published})`);
server.close();


console.log(`
${failures === 0 ? "CHILD CHECKS PASSED" : failures + " CHILD CHECK(S) FAILED"}`);
process.exit(failures === 0 ? 0 : 1);
