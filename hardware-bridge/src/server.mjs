import http from "node:http";
import crypto from "node:crypto";
import { buildDrawerPulse, buildEscPosJob } from "./escpos.mjs";
import { readScaleCommand, sendNetworkRaw, sendWindowsRaw, writeCustomerDisplayCommand } from "./adapters.mjs";
import { buildCustomerDisplayFrame } from "./customer-display.mjs";
import { buildQrPaymentSlip } from "./qr-raster.mjs";
import { PrintJobJournal } from "./job-journal.mjs";
import { defaultConfigPath, loadBridgeConfig, saveBridgeConfig } from "./config.mjs";
import { consumePairingCode } from "./pairing.mjs";
import { plainHardwareError } from "./plain-errors.mjs";
import { UpdateChecker } from "./update-check.mjs";
import { fingerprintPrintPayload, PrintJobExecutor } from "./print-executor.mjs";
import { normalizeTallyUrl, parseTallyResponse, postTallyEnvelope, tallyFailureMessage } from "./tally-gateway.mjs";

const HOST = "127.0.0.1";
const PORT = Number(process.env.KIRANA_BRIDGE_PORT || 17873);
const VERSION = "1.4.0";
const CONFIG_PATH = defaultConfigPath();
let bridgeConfig = await loadBridgeConfig(CONFIG_PATH);
const TOKEN = String(bridgeConfig.token || "");
const TRANSPORT = String(bridgeConfig.printer?.transport || "").toLowerCase();
const ALLOWED_ORIGINS = new Set(bridgeConfig.allowedOrigins);
const MAX_BODY_BYTES = 1024 * 1024;
// A year of vouchers is a far bigger document than a receipt, and refusing it
// here would cap how much history a shop can ever move into Tally.
const MAX_TALLY_BODY_BYTES = 16 * 1024 * 1024;

// A misconfigured address should stop the bridge at startup, where an installer
// or an operator sees it, rather than at the moment a shopkeeper presses send.
let TALLY_TARGET = null;
try { TALLY_TARGET = normalizeTallyUrl(bridgeConfig.tally?.url); }
catch (error) { console.error(`Tally address is not usable: ${error.message}`); process.exit(1); }
const printJournal = new PrintJobJournal();
const updateChecker = new UpdateChecker({ currentVersion: VERSION, manifestUrl: bridgeConfig.updateManifestUrl });
let pairingExchange = Promise.resolve();
let customerDisplayExchange = Promise.resolve();
let lastCustomerDisplayRevision = -1;

if (TOKEN.length < 32) {
  console.error("KIRANA_BRIDGE_TOKEN must be a random value of at least 32 characters.");
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

async function readJson(req, maxBytes = MAX_BODY_BYTES) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error("Request body is too large"), { status: 413 });
    chunks.push(chunk);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); }
  catch { throw Object.assign(new Error("Request body must be valid JSON"), { status: 400 }); }
}

async function sendRaw(buffer) {
  if (TRANSPORT === "network") return sendNetworkRaw(buffer, { host: bridgeConfig.printer.host, port: bridgeConfig.printer.port || 9100 });
  if (TRANSPORT === "windows") return sendWindowsRaw(buffer, { printerName: bridgeConfig.printer.name });
  throw Object.assign(new Error("Printer transport is not configured"), { status: 503 });
}

const printExecutor = new PrintJobExecutor({
  journal: printJournal,
  sendRaw,
  buildBuffer: ({ html, paperSize, autoCut, cashDrawer }, completedCopies) => buildEscPosJob({
    html,
    paperSize,
    autoCut,
    // A sale opens the drawer once, not once per customer/shop copy.
    cashDrawer: cashDrawer && completedCopies === 0,
  }),
});

async function exchangePairingCode(code) {
  const operation = pairingExchange.then(async () => {
    bridgeConfig = await loadBridgeConfig(CONFIG_PATH);
    try { consumePairingCode(bridgeConfig.pairing, code); }
    catch (error) {
      if (error?.persistPairing) await saveBridgeConfig(CONFIG_PATH, bridgeConfig);
      throw error;
    }
    await saveBridgeConfig(CONFIG_PATH, bridgeConfig);
    return bridgeConfig.token;
  });
  pairingExchange = operation.catch(() => undefined);
  return operation;
}

async function updateCustomerDisplay(body) {
  const frame = buildCustomerDisplayFrame(body, { width: bridgeConfig.customerDisplay?.width });
  const operation = customerDisplayExchange.then(async () => {
    if (frame.revision <= lastCustomerDisplayRevision) {
      return { stale: true, revision: lastCustomerDisplayRevision };
    }
    await writeCustomerDisplayCommand({
      executable: bridgeConfig.customerDisplay?.executable,
      args: bridgeConfig.customerDisplay?.args || [],
      frame,
    });
    lastCustomerDisplayRevision = frame.revision;
    return { stale: false, revision: frame.revision };
  });
  customerDisplayExchange = operation.catch(() => undefined);
  return operation;
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
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);
  if (req.method === "POST" && url.pathname === "/v1/pair") {
    try {
      const body = await readJson(req);
      const token = await exchangePairingCode(body.code);
      return json(res, 200, { ok: true, token }, origin);
    } catch (error) {
      return json(res, Number(error?.status) || 500, { message: String(error?.message || "Pairing failed").slice(0, 180) }, origin);
    }
  }
  if (!authorized(req)) return json(res, 401, { message: "Valid bridge pairing token required" }, origin);

  try {
    if (req.method === "GET" && url.pathname === "/v1/health") {
      return json(res, 200, {
        ok: true,
        version: VERSION,
        deviceName: process.env.KIRANA_BRIDGE_DEVICE_NAME || "KiranaOS Counter Bridge",
        update: updateChecker.snapshot(),
        capabilities: {
          print: ["network", "windows"].includes(TRANSPORT),
          cutter: ["network", "windows"].includes(TRANSPORT),
          cashDrawer: ["network", "windows"].includes(TRANSPORT),
          scale: Boolean(bridgeConfig.scale?.executable),
          customerDisplay: Boolean(bridgeConfig.customerDisplay?.executable),
          qrPrint: ["network", "windows"].includes(TRANSPORT),
          // The app reads this rather than comparing versions: an older bridge
          // simply omits it, which reads as "cannot post to Tally" without the
          // app needing to know which release added the ability.
          tally: Boolean(TALLY_TARGET),
        },
      }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/test-print") {
      await readJson(req);
      await sendRaw(buildEscPosJob({
        html: "<h1>KiranaOS</h1><p>Printer setup successful</p><p>Test receipt - no sale recorded</p>",
        paperSize: "80mm",
        autoCut: true,
        cashDrawer: false,
      }));
      return json(res, 200, { ok: true, message: "Test receipt printed successfully." }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/print") {
      const body = await readJson(req);
      const jobId = String(body.jobId || "").trim();
      if (!/^[a-zA-Z0-9:_-]{8,160}$/.test(jobId)) return json(res, 400, { message: "A valid print job id is required" }, origin);
      if (typeof body.html !== "string" || !body.html.trim() || body.html.length > 900_000) return json(res, 400, { message: "Receipt HTML is required" }, origin);
      const copies = Math.min(5, Math.max(1, Math.floor(Number(body.copies) || 1)));
      const paperSize = ["58mm", "76mm", "80mm"].includes(body.paperSize) ? body.paperSize : "80mm";
      const autoCut = body.autoCut !== false;
      const cashDrawer = body.cashDrawer === true;
      const payloadFingerprint = fingerprintPrintPayload({ html: body.html, paperSize, autoCut, cashDrawer });
      const outcome = await printExecutor.run({ jobId, copies, html: body.html, paperSize, autoCut, cashDrawer, payloadFingerprint });
      return json(res, 200, { ok: true, jobId, ...outcome }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/cash-drawer/open") {
      await readJson(req);
      await sendRaw(buildDrawerPulse());
      return json(res, 200, { ok: true }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/scale/read") {
      await readJson(req);
      const reading = await readScaleCommand({ executable: bridgeConfig.scale?.executable, args: bridgeConfig.scale?.args || [] });
      return json(res, 200, { ok: true, ...reading }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/print-qr") {
      const body = await readJson(req);
      // Deliberately not journalled like /v1/print: a payment QR slip carries no
      // sale, so reprinting one is safe and is something customers do ask for.
      const paperSize = ["58mm", "76mm", "80mm"].includes(body.paperSize) ? body.paperSize : "80mm";
      await sendRaw(buildQrPaymentSlip({
        moduleCount: Number(body.moduleCount),
        modules: body.modules,
        amountPaise: body.amountPaise,
        paperSize,
        reference: body.reference,
      }));
      return json(res, 200, { ok: true }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/tally/post") {
      if (!TALLY_TARGET) return json(res, 503, { message: "This counter is not set up to send to Tally. Add the Tally address in Hardware Bridge Setup." }, origin);
      const body = await readJson(req, MAX_TALLY_BODY_BYTES);
      const xml = typeof body.xml === "string" ? body.xml : "";
      // Only an import envelope goes to Tally. This is not a security boundary —
      // the caller is already paired — but it turns "Tally rejected something
      // incomprehensible" into a failure that names its own cause.
      if (!xml.trim()) return json(res, 400, { message: "Tally envelope is required" }, origin);
      if (!/^\s*(<\?xml[^>]*\?>)?\s*<ENVELOPE[\s>]/i.test(xml)) return json(res, 400, { message: "Body is not a Tally import envelope" }, origin);

      // Handled here rather than by the shared catch below, whose messages are
      // written for a printer — telling a shopkeeper to check paper and cables
      // when Tally is simply closed sends them to the wrong machine entirely.
      let status;
      let reply;
      try { ({ status, body: reply } = await postTallyEnvelope({ target: TALLY_TARGET, xml })); }
      catch (error) {
        return json(res, Number(error?.status) || 502, { message: String(error?.message || "Sending to Tally failed.").slice(0, 300) }, origin);
      }
      if (status !== 200) return json(res, 502, { message: `Tally answered with HTTP ${status}.` }, origin);

      const result = parseTallyResponse(reply);
      // Reported separately from the HTTP result on purpose: Tally answers 200
      // even when it imported nothing, so "ok" here means the vouchers are
      // actually in the books, which is what decides whether the app may record
      // them as sent.
      if (!result.ok) return json(res, 422, { ok: false, message: tallyFailureMessage(result, reply), ...result }, origin);
      return json(res, 200, { ok: true, ...result }, origin);
    }
    if (req.method === "POST" && url.pathname === "/v1/customer-display/show") {
      const body = await readJson(req);
      const outcome = await updateCustomerDisplay(body);
      return json(res, 200, { ok: true, ...outcome }, origin);
    }
    return json(res, 404, { message: "Hardware bridge endpoint not found" }, origin);
  } catch (error) {
    return json(res, Number(error?.status) || 500, { message: plainHardwareError(error) }, origin);
  }
});

server.requestTimeout = 15_000;
server.headersTimeout = 10_000;
server.listen(PORT, HOST, () => console.log(`KiranaOS hardware bridge listening on http://${HOST}:${PORT}`));
void updateChecker.check();
setInterval(() => void updateChecker.check(), 6 * 60 * 60 * 1000).unref();
