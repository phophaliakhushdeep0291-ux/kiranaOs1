import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_OFFLINE_FRONTEND_URL || "http://localhost:51977";
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const API_HEALTH_URL = `${API_URL.replace(/\/api$/, "")}/health`;
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_OFFLINE_DEBUG_PORT || 9484);
const OUTPUT_DIR = path.resolve(process.env.QA_OFFLINE_OUTPUT_DIR || "qa-artifacts/offline-core-restart");
const BUILD_DIR = path.resolve(process.env.QA_OFFLINE_BUILD_DIR || path.join(OUTPUT_DIR, "dist"));
const PROFILE_DIR = path.resolve(process.env.QA_OFFLINE_PROFILE_DIR || path.join(tmpdir(), "artha-offline-core-restart-profile"));
const BUILD_ID = process.env.QA_OFFLINE_BUILD_ID || "offline-core-restart-qa";
const VIEWPORT = { width: 390, height: 844 };
const ALL_ROUTES = [
  ["OQA-DASH-01", "/dashboard", false],
  ["OQA-BILL-01", "/billing", false],
  ["OQA-IMPORT-01", "/import-order", false],
  ["OQA-RETURN-01", "/returns/new", false],
  ["OQA-HIST-01", "/bills", false],
  ["OQA-BILL-DETAIL-01", "/bills/offline-missing-bill", false],
  ["OQA-ORDER-01", "/orders-received", false],
  ["OQA-SALES-01", "/sales-overview", false],
  ["OQA-PROD-01", "/products", false],
  ["OQA-CUST-01", "/customers", false],
  ["OQA-CUST-DETAIL-01", "/customers/offline-missing-customer", false],
  ["OQA-INV-01", "/inventory", false],
  ["OQA-STOCK-IN-01", "/inventory/stock-in", false],
  ["OQA-STOCK-OUT-01", "/inventory/stock-out", false],
  ["OQA-ADJUST-01", "/inventory/adjustments", false],
  ["OQA-COUNT-01", "/inventory/stock-counts", false],
  ["OQA-CATEGORY-01", "/categories", false],
  ["OQA-PUR-01", "/purchase-bills", false],
  ["OQA-SUPPLIER-01", "/suppliers", false],
  ["OQA-EXPENSE-01", "/expenses", false],
  ["OQA-OFFER-01", "/offers", false],
  ["OQA-LOYALTY-01", "/loyalty", true],
  ["OQA-GIFT-01", "/gift-cards", true],
  ["OQA-RPT-01", "/reports", false],
  ["OQA-CHANNEL-01", "/channel-settlements", true],
  ["OQA-MONEY-01", "/money-statement", false],
  ["OQA-CLOSING-01", "/daily-closing", false],
  ["OQA-SET-01", "/settings", false],
  ["OQA-PROFILE-01", "/settings/store-profile", false],
  ["OQA-MODULE-01", "/settings/modules", false],
  ["OQA-PRINTER-01", "/settings/printer", false],
  ["OQA-BILL-SET-01", "/settings/billing", false],
  ["OQA-STAFF-SET-01", "/settings/staff", false],
  ["OQA-DEVICE-SET-01", "/settings/devices", true],
  ["OQA-SYNC-SET-01", "/settings/sync", false],
  ["OQA-TAX-SET-01", "/settings/taxes", false],
  ["OQA-SECURITY-01", "/settings/security", false],
  ["OQA-NOTIFY-01", "/settings/notifications", true],
  ["OQA-INTEGRATION-01", "/settings/integrations", true],
  ["OQA-ADVANCED-01", "/settings/advanced", false],
  ["OQA-SYNC-01", "/sync-status", false],
  ["OQA-PLAN-01", "/plans", true],
  ["OQA-SUBSCRIPTION-01", "/subscription", true],
  ["OQA-DEVICE-01", "/devices", true],
  ["OQA-HELP-01", "/help", true],
  ["OQA-ACTIVITY-01", "/activity-insights", true],
  ["OQA-STAFF-01", "/staff", false],
  ["OQA-AUDIT-01", "/audit-logs", false],
  ["OQA-ASSURANCE-01", "/assurance", true],
  ["OQA-RECYCLE-01", "/recycle-bin", false],
  ["OQA-SMART-01", "/smart-tools", false],
  ["OQA-REC-01", "/recovery-mode", false],
];
const ROUTE_FILTER = String(process.env.QA_OFFLINE_ROUTE_FILTER || "")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
const ROUTES = ROUTE_FILTER.length
  ? ALL_ROUTES.filter(([qaId, route]) => ROUTE_FILTER.includes(qaId) || ROUTE_FILTER.includes(route))
  : ALL_ROUTES;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function waitForUrl(url, timeout = 30_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* process is starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForUrlDown(url, timeout = 15_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { await fetch(url); } catch { return; }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url} to close`);
}

async function waitForPage(client, expression, timeout = 45_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    try { if (await client.evaluate(expression)) return; } catch { /* navigation swaps execution contexts */ }
    await sleep(150);
  }
  const state = await client.evaluate(`({href:location.href,text:document.body?.innerText?.slice(0,1500),technical:document.querySelector("details pre")?.textContent||null,errors:window.__arthaQaErrors||[],consoleErrors:window.__arthaQaConsoleErrors||[]})`).catch(() => null);
  throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
}

async function waitForExit(child, timeout = 5_000) {
  if (child.exitCode !== null) return;
  await Promise.race([
    new Promise((resolve) => child.once("exit", resolve)),
    sleep(timeout),
  ]);
}

async function runBuild() {
  const child = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "build", "--configLoader", "runner", "--config", "vite.config.ts",
  ], {
    cwd: path.resolve("."),
    env: { ...process.env, VITE_API_BASE_URL: API_URL, KIRANA_BUILD_ID: BUILD_ID, KIRANA_OUT_DIR: BUILD_DIR },
    windowsHide: true,
    stdio: "inherit",
  });
  const exitCode = await new Promise((resolve, reject) => {
    child.once("error", reject);
    child.once("exit", resolve);
  });
  assert(exitCode === 0, `Production build failed with exit code ${exitCode}`);
}

async function startPreview() {
  const preview = spawn(process.execPath, [
    "node_modules/vite/bin/vite.js", "preview", "--config", "vite.config.ts",
    "--host", "127.0.0.1", "--port", String(new URL(FRONTEND_URL).port || 4173), "--strictPort",
  ], {
    cwd: path.resolve("."),
    env: { ...process.env, KIRANA_OUT_DIR: BUILD_DIR },
    windowsHide: true,
    stdio: "ignore",
  });
  await waitForUrl(FRONTEND_URL);
  return preview;
}

async function launchChrome(initialUrl, debugPort) {
  let stderr = "";
  const chrome = spawn(CHROME_PATH, [
    "--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    "--remote-debugging-address=127.0.0.1", `--remote-debugging-port=${debugPort}`, `--user-data-dir=${PROFILE_DIR}`, initialUrl,
  ], { windowsHide: true, stdio: ["ignore", "ignore", "pipe"] });
  chrome.stderr?.on("data", (chunk) => { stderr = `${stderr}${String(chunk)}`.slice(-8_000); });
  try {
    await waitForUrl(`http://127.0.0.1:${debugPort}/json/version`, 60_000);
  } catch (error) {
    if (chrome.exitCode === null) chrome.kill();
    await waitForExit(chrome, 5_000);
    throw new Error(`Chrome QA launch failed on port ${debugPort} (exit ${chrome.exitCode ?? "running"}). ${error.message}${stderr ? `\n${stderr}` : ""}`);
  }
  const targets = await (await fetch(`http://127.0.0.1:${debugPort}/json`)).json();
  const target = targets.find((item) => item.type === "page");
  assert(target, "Chrome did not create a page target");
  const client = new CdpClient(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await client.send("Network.enable");
  await client.send("Page.addScriptToEvaluateOnNewDocument", {
    source: `window.__arthaQaErrors=[];window.__arthaQaConsoleErrors=[];const __arthaConsoleError=console.error.bind(console);console.error=(...args)=>{window.__arthaQaConsoleErrors.push(args.map(value=>String(value?.stack||value)).join(" ").slice(0,4000));return __arthaConsoleError(...args)};window.addEventListener("error",event=>window.__arthaQaErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener("unhandledrejection",event=>window.__arthaQaErrors.push(String(event.reason?.stack||event.reason)));`,
  });
  return { chrome, client, debugPort };
}

async function closeChrome(client, chrome, debugPort) {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  await waitForExit(chrome, 15_000);
  if (chrome.exitCode === null) {
    chrome.kill();
    await waitForExit(chrome, 5_000);
  }
  await waitForUrlDown(`http://127.0.0.1:${debugPort}/json/version`, 15_000);
  // Chrome can release its process before the persistent profile's file locks.
  await sleep(1_500);
}

async function prepareAppOrigin(client) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}/manifest.webmanifest` });
  await waitForPage(client, `document.readyState === "complete" && location.origin === ${JSON.stringify(FRONTEND_ORIGIN)}`);
}

async function ensureSession(client) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const outcome = await client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},sessionKey="kiranaos.auth.session.v1",mobileKey="kiranaos.qa.offline.mobile",password="Test@12345";
    let deviceId=localStorage.getItem("kiranaos_device_id")||localStorage.getItem("kirana-os:device-id:v1");
    if(!deviceId){deviceId="offline_restart_"+crypto.randomUUID();localStorage.setItem("kiranaos_device_id",deviceId);localStorage.setItem("kirana-os:device-id:v1",deviceId)}
    let stored={};try{stored=JSON.parse(localStorage.getItem(sessionKey)||"{}")||{}}catch{}
    const headers=(token)=>({authorization:"Bearer "+token,"x-device-id":deviceId});
    const save=(auth)=>{const session={accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop};localStorage.setItem(sessionKey,JSON.stringify(session));return session};
    const verify=async(session)=>session?.accessToken&&Boolean((await fetch(apiUrl+"/auth/me",{headers:headers(session.accessToken)})).ok);
    if(await verify(stored))return "reused";
    if(stored.refreshToken){const response=await fetch(apiUrl+"/auth/refresh",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({refreshToken:stored.refreshToken})});if(response.ok){const json=await response.json(),session=save(json.data??json);if(await verify(session))return "refreshed"}}
    const knownMobile=localStorage.getItem(mobileKey)||stored.user?.mobile||stored.user?.phone||"";
    if(knownMobile){const response=await fetch(apiUrl+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({mobile:knownMobile,password})}),json=await response.json();if(!response.ok)throw new Error("QA login failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,knownMobile);return "logged-in"}
    const qaMobile="7"+${JSON.stringify(runId)}.slice(-9),response=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"Offline Restart QA",ownerName:"QA Owner",city:"Jaipur",address:"Automated offline QA",mobile:qaMobile,password,ownerPin:"2468"})}),json=await response.json();if(!response.ok)throw new Error("Registration failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,qaMobile);return "registered"
  })()`);
  console.log(`Offline QA auth session: ${outcome}`);
}

async function seedCoreData(client) {
  return client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},session=JSON.parse(localStorage.getItem("kiranaos.auth.session.v1")||"{}"),deviceId=localStorage.getItem("kiranaos_device_id"),headers={"content-type":"application/json",authorization:"Bearer "+session.accessToken,"x-device-id":deviceId,"x-owner-pin":"2468"};
    const request=async(path,options={})=>{const response=await fetch(apiUrl+path,{...options,headers:{...headers,...(options.headers||{})}}),json=await response.json();if(!response.ok)throw new Error(path+": "+JSON.stringify(json));return json.data??json};
    const products=await request("/products");
    if(!products.some(product=>product.name==="Offline Matrix Rice"))await request("/products",{method:"POST",body:JSON.stringify({name:"Offline Matrix Rice",category:"Grocery",displayUnit:"kg",baseUnit:"kg",rateUnit:"kg",stockBaseQty:25,costPerRateUnit:42,minPricePerRateUnit:45,defaultPricePerRateUnit:50,mrp:55,gstRate:5})});
    const customers=await request("/customers");
    if(!customers.some(customer=>customer.name==="Offline Matrix Customer"))await request("/customers",{method:"POST",body:JSON.stringify({name:"Offline Matrix Customer",mobile:"9876504321",type:"regular"})});
    return true
  })()`);
}

async function navigateOnline(client, route) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`);
  await sleep(800);
}

async function primeOfflineInstall(client) {
  await prepareAppOrigin(client);
  await ensureSession(client);
  await seedCoreData(client);
  await navigateOnline(client, "/dashboard");
  await waitForPage(client, `navigator.serviceWorker && navigator.serviceWorker.ready.then(()=>true)`);
  await waitForPage(client, `navigator.serviceWorker.controller !== null`);
  // Do not visit every route before cutting the network. That used to warm each
  // lazy chunk through runtime caching and made the QA pass even when the
  // install manifest was incomplete. Only hydrate the two local-data screens;
  // every other route must survive solely because installation precached it.
  await navigateOnline(client, "/products");
  await waitForPage(client, `document.body.innerText.includes("Offline Matrix Rice")`, 60_000);
  await navigateOnline(client, "/customers");
  await waitForPage(client, `document.body.innerText.includes("Offline Matrix Customer")`, 60_000);
  const cacheState = await client.evaluate(`(async()=>{const keys=(await caches.keys()).filter(key=>key.startsWith("kiranaos-shell"));const entries=[];for(const key of keys){const cache=await caches.open(key);entries.push(...(await cache.keys()).map(request=>new URL(request.url).pathname))}return{keys,entryCount:new Set(entries).size,hasIndex:entries.includes("/index.html"),hasManifest:entries.includes("/manifest.webmanifest"),hasOffline:entries.includes("/offline.html"),hasScript:entries.some(path=>path.endsWith(".js")),hasStyles:entries.some(path=>path.endsWith(".css")),hasCoreMarker:entries.some(path=>path.startsWith("/__offline/core/"))}})()`);
  assert(cacheState.keys.length > 0 && cacheState.hasIndex && cacheState.hasManifest && cacheState.hasOffline && cacheState.hasScript && cacheState.hasStyles && cacheState.hasCoreMarker, `Offline shell did not finish caching: ${JSON.stringify(cacheState)}`);
  return cacheState;
}

async function setOffline(client) {
  await client.send("Network.emulateNetworkConditions", {
    offline: true,
    latency: 0,
    downloadThroughput: 0,
    uploadThroughput: 0,
    connectionType: "none",
  });
  await sleep(500);
}

async function auditOfflineRoute(client, qaId, route, expectsInternetRequired = false) {
  const startedAt = Date.now();
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`, 60_000);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`, 60_000);
  if (route === "/products") await waitForPage(client, `document.body.innerText.includes("Offline Matrix Rice")`, 15_000);
  if (route === "/customers") await waitForPage(client, `document.body.innerText.includes("Offline Matrix Customer")`, 15_000);
  if (route === "/recovery-mode") await waitForPage(client, `/Database open|Local database problem detected/.test(document.body.innerText)`, 15_000);
  const readyMs = Date.now() - startedAt;
  await sleep(500);
  // navigator.onLine is only a network-interface hint and can remain true while
  // every request is blocked. Prove the cut with an uncached cross-origin fetch.
  const networkBlocked = await client.evaluate(`fetch(${JSON.stringify(API_HEALTH_URL)}+"?offlineProbe="+Date.now(),{cache:"no-store"}).then(()=>false).catch(()=>true)`);
  const metrics = await client.evaluate(`(()=>{const text=document.body.innerText,main=document.getElementById("main-content"),loading=document.querySelector('.app-loading-surface[aria-busy="true"]');return{path:location.pathname,online:navigator.onLine,controlled:Boolean(navigator.serviceWorker?.controller),windowScrollTop:Math.round(window.scrollY),mainScrollTop:Math.round(main?.scrollTop||0),documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,genericFailure:/something went wrong|unexpected error|page failed to load|application failed to start/i.test(text),localDbProblem:text.includes("Local database problem detected"),internetRequired:Boolean(document.querySelector('[data-testid="internet-required-route"]')),stuckLoading:Boolean(loading),loadingText:loading?.textContent?.replace(/\\s+/g," ").trim().slice(0,300)||null,runtimeErrors:window.__arthaQaErrors||[],resources:performance.getEntriesByType("resource").map(entry=>new URL(entry.name).pathname).filter(path=>path.endsWith(".js")||path.endsWith(".css")).slice(-40),hasSeedProduct:text.includes("Offline Matrix Rice"),hasSeedCustomer:text.includes("Offline Matrix Customer"),hasLocalBackupTool:text.includes("Encrypted local emergency backup")&&text.includes("Export local backup")&&text.includes("Works offline")}})()`);
  const cacheDiagnostics = metrics.stuckLoading
    ? await client.evaluate(`(async()=>{const keys=(await caches.keys()).filter(key=>key.startsWith("kiranaos-shell")),paths=[];for(const key of keys){const cache=await caches.open(key);paths.push(...(await cache.keys()).map(request=>new URL(request.url).pathname))}const assets=[...new Set(paths.filter(path=>path.endsWith(".js")||path.endsWith(".css")))];return{keys,assetCount:assets.length,pageAssets:assets.filter(path=>/Page-|Dialog-/i.test(path)).slice(-80)}})()`)
    : null;
  const screenshot = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${qaId.toLowerCase()}-${VIEWPORT.width}x${VIEWPORT.height}.png`;
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(screenshot.data, "base64"));
  assert(metrics.path === route, `${qaId} bounced from ${route} to ${metrics.path}`);
  assert(networkBlocked, `${qaId} reached an uncached backend probe while the network was meant to be disabled`);
  assert(metrics.controlled, `${qaId} was not served under the installed service worker`);
  assert(readyMs <= 10_000, `${qaId} took ${readyMs}ms to become usable after an offline cold restart`);
  assert(metrics.windowScrollTop <= 1 && metrics.mainScrollTop <= 1, `${qaId} opened at a stale scroll position: ${JSON.stringify(metrics)}`);
  assert(metrics.documentWidth <= VIEWPORT.width + 1 && metrics.bodyWidth <= VIEWPORT.width + 1, `${qaId} overflowed offline: ${JSON.stringify(metrics)}`);
  assert(!metrics.genericFailure, `${qaId} rendered a fatal offline error`);
  assert(!metrics.stuckLoading, `${qaId} remained stuck loading offline: ${JSON.stringify({ ...metrics, cacheDiagnostics })}`);
  assert(metrics.runtimeErrors.length === 0, `${qaId} runtime errors offline: ${metrics.runtimeErrors.join(" | ")}`);
  assert(metrics.internetRequired === expectsInternetRequired, `${qaId} offline capability label mismatch: ${JSON.stringify(metrics)}`);
  if (route === "/products") assert(metrics.hasSeedProduct, `${qaId} did not restore cached product data`);
  if (route === "/customers") assert(metrics.hasSeedCustomer, `${qaId} did not restore cached customer data`);
  if (route === "/recovery-mode") {
    assert(!metrics.localDbProblem, `${qaId} falsely reported a local database problem`);
    assert(metrics.hasLocalBackupTool, `${qaId} did not expose the encrypted local backup tool offline`);
  }
  return { qaId, route, networkBlocked, readyMs, ...metrics, screenshot: filename };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });
  await waitForUrl(`${API_URL.replace(/\/api$/, "")}/health/ready`);
  if (process.env.QA_OFFLINE_SKIP_BUILD !== "true") await runBuild();
  const preview = await startPreview();
  let onlineBrowser;
  let offlineBrowser;
  try {
    onlineBrowser = await launchChrome("about:blank", DEBUG_PORT);
    const cacheState = await primeOfflineInstall(onlineBrowser.client);
    await closeChrome(onlineBrowser.client, onlineBrowser.chrome, onlineBrowser.debugPort);
    onlineBrowser = null;

    offlineBrowser = await launchChrome("about:blank", DEBUG_PORT + 1);
    await offlineBrowser.client.send("Emulation.setDeviceMetricsOverride", { ...VIEWPORT, deviceScaleFactor: 1, mobile: true });
    await setOffline(offlineBrowser.client);
    const results = [];
    for (const [qaId, route, expectsInternetRequired] of ROUTES) results.push(await auditOfflineRoute(offlineBrowser.client, qaId, route, expectsInternetRequired));
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), buildId: BUILD_ID, frontendUrl: FRONTEND_URL, cacheState, coldRestart: true, networkDisabled: true, results }, null, 2));
    console.log(`Offline cold-restart matrix passed ${results.length}/${results.length} routes. Artifacts: ${OUTPUT_DIR}`);
  } finally {
    if (onlineBrowser) await closeChrome(onlineBrowser.client, onlineBrowser.chrome, onlineBrowser.debugPort);
    if (offlineBrowser) await closeChrome(offlineBrowser.client, offlineBrowser.chrome, offlineBrowser.debugPort);
    if (preview.exitCode === null) preview.kill();
    await waitForExit(preview);
  }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
