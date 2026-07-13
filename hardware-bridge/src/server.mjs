import http from "node:http";
import crypto from "node:crypto";
import { buildDrawerPulse, buildEscPosJob } from "./escpos.mjs";
import { readScaleCommand, sendNetworkRaw, sendWindowsRaw } from "./adapters.mjs";
import { PrintJobJournal } from "./job-journal.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.KIRANA_BRIDGE_PORT || 17873);
const TOKEN = String(process.env.KIRANA_BRIDGE_TOKEN || "");
const TRANSPORT = String(process.env.KIRANA_BRIDGE_PRINTER_TRANSPORT || "").toLowerCase();
const ALLOWED_ORIGINS = new Set(String(process.env.KIRANA_BRIDGE_ALLOWED_ORIGINS || "http://127.0.0.1:5173,http://localhost:5173")
  .split(",").map((value) => value.trim()).filter(Boolean));
const MAX_BODY_BYTES = 1024 * 1024;
const printJournal = new PrintJobJournal();
const inFlightPrintJobs = new Map();

if (TOKEN.length < 16) {
  console.error("KIRANA_BRIDGE_TOKEN must be a random value of at least 16 characters.");
  process.exit(1);
}

await printJournal.load();

function json(res, status, body, origin) {
  if (origin && ALLOWED_ORIGINS.has(origin)) {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("vary", "origin");
  }
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" });
  res.end(JSON.stringify(body));
}

function authorized(req) {
  const supplied = String(req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  const expected = Buffer.from(TOKEN);
  const actual = Buffer.from(supplied);
  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

async function readJson(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 }); }
}

async function sendRaw(buffer) {
  if (TRANSPORT === "network") return sendNetworkRaw(buffer, { host: process.env.KIRANA_BRIDGE_PRINTER_HOST, port: process.env.KIRANA_BRIDGE_PRINTER_PORT || 9100 });
  if (TRANSPORT === "windows") return sendWindowsRaw(buffer, { printerName: process.env.KIRANA_BRIDGE_PRINTER_NAME });
  throw Object.assign(new Error("Printer transport is not configured"), { status: 503 });
}

const server = http.createServer(async (req, res) => {
  const origin = String(req.headers.origin || "");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return json(res, 403, { message: "Origin is not paired with this bridge" });
  if (req.method === "OPTIONS") {
    res.setHeader("access-control-allow-origin", origin);
    res.setHeader("access-control-allow-methods", "GET,POST,OPTIONS");
    res.setHeader("access-control-allow-headers", "authorization,content-type");
    res.setHeader("access-control-max-age", "600");
    res.writeHead(204); return res.end();
  }
  if (!authorized(req)) return json(res, 401, { message: "Valid bridge pairing token required" }, origin);

  try {
    const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(res, 200, {
        ok: true,
        version: "1.0.0",
        deviceName: process.env.KIRANA_BRIDGE_DEVICE_NAME || "KiranaOS Counter Bridge",
        capabilities: {
          print: ["network", "windows"].includes(TRANSPORT),
          cutter: ["network", "windows"].includes(TRANSPORT),
          cashDrawer: ["network", "windows"].includes(TRANSPORT),
          scale: Boolean(process.env.KIRANA_BRIDGE_SCALE_EXECUTABLE),
        },
      }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/print") {
      const body = await readJson(req);
      const jobId = String(body.jobId || "").trim();
      if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(jobId)) return json(res, 400, { message: "A valid print job id is required" }, origin);
      if (typeof body.html !== "string" || !body.html.trim() || body.html.length > 900_000) return json(res, 400, { message: "Receipt HTML is required" }, origin);
      const copies = Math.min(5, Math.max(1, Math.floor(Number(body.copies) || 1)));
      const active = inFlightPrintJobs.get(jobId);
      if (active) {
        if (active.copies !== copies) return json(res, 409, { message: "Print job id is already active with a different copy count" }, origin);
        await active.promise;
        return json(res, 200, { ok: true, jobId, duplicate: true, completedCopies: copies }, origin);
      }
      const promise = (async () => {
        const existing = await printJournal.begin(jobId, copies);
        if (existing.completedCopies >= copies) return { completedCopies: copies, duplicate: true, resumed: false };
        let completedCopies = existing.completedCopies;
        while (completedCopies < copies) {
          await sendRaw(buildEscPosJob(body));
          const progress = await printJournal.recordCopy(jobId);
          completedCopies = progress.completedCopies;
        }
        return { completedCopies, duplicate: false, resumed: existing.completedCopies > 0 };
      })();
      inFlightPrintJobs.set(jobId, { copies, promise });
      try {
        const outcome = await promise;
        return json(res, 200, { ok: true, jobId, ...outcome }, origin);
      } finally {
        inFlightPrintJobs.delete(jobId);
      }
    }
    if (req.method === "POST" && url.pathname === "/v1/cash-drawer/open") {
      await readJson(req);
      await sendRaw(buildDrawerPulse());
      return json(res, 200, { ok: true }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/scale/read") {
      await readJson(req);
      let args = [];
      try { args = JSON.parse(process.env.KIRANA_BRIDGE_SCALE_ARGS_JSON || "[]"); } catch { throw Object.assign(new Error("Scale arguments are invalid"), { status: 503 }); }
      if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) throw Object.assign(new Error("Scale arguments must be a JSON string array"), { status: 503 });
      const reading = await readScaleCommand({ executable: process.env.KIRANA_BRIDGE_SCALE_EXECUTABLE, args });
      return json(res, 200, { ok: true, ...reading }, origin);
    }
    return json(res, 404, { message: "Hardware bridge endpoint not found" }, origin);
  } catch (error) {
    return json(res, Number(error?.status) || 500, { message: String(error?.message || "Hardware operation failed").slice(0, 300) }, origin);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => console.log(`KiranaOS hardware bridge listening on http://${HOST}:${PORT}`));
