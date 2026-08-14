/**
 * Mobile matrix for the trade-specific screens.
 *
 * `capture-mobile-core-matrix-v1.mjs` covers the screens every shop shares. The
 * eleven vertical packs each add their own, and those are only reachable when the
 * shop is that trade — so this harness registers one throwaway shop per trade and
 * walks its routes at the same four widths.
 *
 * Two things about the setup are not obvious and are easy to get wrong:
 *
 *   1. The trade must be written BEFORE the shop has any products. The server
 *      refuses the change once products or bills exist ("Business type cannot be
 *      changed after products or bills exist", 409), so the order below —
 *      register, PATCH settingsJson.storeProfile.businessTypeKey, then seed — is
 *      the only order that works.
 *
 *   2. Each trade starts from a wiped origin. The device id lives in IndexedDB
 *      and outranks localStorage, so carrying one trade's identity into the next
 *      shop makes the app treat the new session as a final auth failure and drop
 *      to /login with no request in the network log.
 *
 * Seeding a record matters as much as seeding products: an empty trade screen
 * renders only its chrome, and the edit/delete controls on a populated card go
 * unmeasured. The stationery entry below is the worked example.
 *
 * Reading a failure: the audit deliberately measures controls inside a CLOSED
 * slide-over panel too, because those are laid out but parked off to the right.
 * That is how panel close and remove buttons get covered — but it also means a
 * reported control may live in a sheet nobody has opened yet.
 */
import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://127.0.0.1:5173";
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
// Distinct from the core matrix so both can run at once.
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9483);
const OUTPUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || "qa-artifacts/mobile-vertical-matrix");
const PROFILE_DIR = path.resolve(process.env.QA_PROFILE_DIR || path.join(tmpdir(), "artha-mobile-vertical-matrix-profile"));
const VIEWPORTS = [[375, 667], [390, 844], [430, 932], [768, 1024]];

/**
 * One entry per trade, in the order they are visited. `records` are posted after
 * the products so the trade's list screens have a populated card to measure.
 */
const VERTICALS = [
  { trade: "clothing", routes: [["MQA-CLO-01", "/rentals"]] },
  { trade: "footwear", routes: [["MQA-FTW-01", "/size-runs"]] },
  { trade: "auto_parts", routes: [["MQA-AUT-01", "/fitment"]] },
  { trade: "electronics", routes: [["MQA-ELE-01", "/serial-units"]] },
  { trade: "pharmacy", routes: [["MQA-PHA-01", "/prescriptions"]] },
  {
    trade: "stationery",
    routes: [["MQA-STA-01", "/book-lists"]],
    records: [{
      path: "/book-lists",
      body: {
        schoolName: "Delhi Public School", className: "Class 6", academicYear: "2026-27", isActive: true,
        items: [
          { productId: null, name: "Mathematics Textbook", qty: 1, unit: "piece", isOptional: false, sortOrder: 0 },
          { productId: null, name: "Geometry Box", qty: 1, unit: "piece", isOptional: true, sortOrder: 1 },
        ],
      },
    }],
  },
  { trade: "furniture", routes: [["MQA-FUR-01", "/orders"]] },
  { trade: "cosmetics", routes: [["MQA-COS-01", "/testers"]] },
  {
    trade: "restaurant",
    routes: [
      ["MQA-RST-01", "/tables"], ["MQA-RST-02", "/kitchen"],
      ["MQA-RST-03", "/menu"], ["MQA-RST-04", "/kitchen-stock"],
    ],
  },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const assert = (value, message) => { if (!value) throw new Error(message); };

class CdpClient {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((resolve, reject) => { this.socket.addEventListener("open", resolve, { once: true }); this.socket.addEventListener("error", reject, { once: true }); });
    this.socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data)), pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
    });
  }
  send(method, params = {}) {
    const id = ++this.id;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const result = await this.send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true, userGesture: true });
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    return result.result.value;
  }
  close() { this.socket?.close(); }
}

async function waitFor(url, timeout = 25_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { const response = await fetch(url); if (response.ok) return; } catch { /* runtime starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function waitForPage(client, expression, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { if (await client.evaluate(expression)) return; await sleep(150); }
  const state = await client.evaluate(`({href:location.href,text:document.body?.innerText?.slice(0,1200),errors:window.__arthaQaErrors||[]})`).catch(() => null);
  throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
}

async function navigate(client, route) {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(route)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`);
  await sleep(900);
}

async function prepareAppOrigin(client) {
  // Use a same-origin static document so the application cannot clear the session
  // this harness is in the middle of writing.
  await client.send("Page.navigate", { url: `${FRONTEND_URL}/manifest.webmanifest` });
  await waitForPage(client, `document.readyState === "complete" && location.origin === ${JSON.stringify(FRONTEND_ORIGIN)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 20`);
}

/** Registers a throwaway shop of one trade and leaves the app signed into it. */
async function startTradeSession(client, trade, records) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`, mobile = `6${runId.slice(-9)}`;
  const outcome = await client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},sessionKey="kiranaos.auth.session.v1",password="Test@12345";
    const bt=${JSON.stringify(trade)},records=${JSON.stringify(records ?? [])};
    // A previous trade's device identity lives in IndexedDB and would outrank
    // anything written below, so the origin starts clean for every shop.
    for(const db of ((await indexedDB.databases?.().catch(()=>[]))||[])) await new Promise(done=>{const request=indexedDB.deleteDatabase(db.name);request.onsuccess=request.onerror=request.onblocked=()=>done();});
    localStorage.clear(); sessionStorage.clear();
    const deviceId="vertical_"+bt+"_"+crypto.randomUUID();
    localStorage.setItem("kiranaos_device_id",deviceId);localStorage.setItem("kirana-os:device-id:v1",deviceId);
    const registration=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"Vertical QA "+bt,ownerName:"QA Owner",city:"Jaipur",address:"Automated QA Address",mobile:${JSON.stringify(mobile)},password,ownerPin:"2468"})});
    const registered=await registration.json(); if(!registration.ok) throw new Error("register: "+JSON.stringify(registered));
    const auth=registered.data??registered, headers={"content-type":"application/json",authorization:"Bearer "+auth.accessToken,"x-device-id":deviceId};
    // The trade has to be set while the shop is still empty — see the file header.
    const shopResponse=await fetch(apiUrl+"/shops",{headers}); let shop=await shopResponse.json(); shop=shop?.data??shop;
    let settings={}; try{settings=JSON.parse(shop?.settingsJson||"{}")||{};}catch{}
    settings.storeProfile={...(settings.storeProfile||{}),businessTypeKey:bt};
    const patch=await fetch(apiUrl+"/shops",{method:"PATCH",headers,body:JSON.stringify({settingsJson:JSON.stringify(settings),ownerPin:"2468"})});
    if(!patch.ok) throw new Error("set business type: "+(await patch.text()));
    const product=(name,price,stock)=>({name,category:"general",aliases:[],displayUnit:"piece",baseUnit:"piece",rateUnit:"piece",stockBaseQty:stock,costPerRateUnit:Math.round(price*0.8),minPricePerRateUnit:0,defaultPricePerRateUnit:price,mrp:price,lowStockThreshold:5,gstRate:0,ownerPin:"2468"});
    for(const [name,price,stock] of [["QA Item One",1299,20],["QA Item Two",499,8],["QA Item Three",249,3]]) await fetch(apiUrl+"/products",{method:"POST",headers,body:JSON.stringify(product(name,price,stock))});
    // Without a record the trade screen shows only its empty state, and the
    // actions that live on a populated card are never measured.
    for(const record of records){const response=await fetch(apiUrl+record.path,{method:"POST",headers,body:JSON.stringify(record.body)});if(!response.ok)throw new Error("seed "+record.path+": "+(await response.text()));}
    localStorage.setItem("kiranaApiBaseUrl",apiUrl);
    localStorage.setItem(sessionKey,JSON.stringify({accessToken:auth.accessToken,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop}));
    sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));
    localStorage.setItem("kirana-os:ui-business-type:v1",bt);
    localStorage.setItem("kirana-os:ui-language:v1","en");
    return bt+" ("+records.length+" seeded record(s))";
  })()`);
  console.log(`  shop ready: ${outcome}`);
}

async function closeChrome(client, chrome) {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  if (chrome.exitCode === null) {
    await Promise.race([new Promise((resolve) => chrome.once("exit", resolve)), sleep(5_000)]);
  }
  if (chrome.exitCode === null) chrome.kill();
}

async function auditPage(client, qaId, route, width, height) {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await navigate(client, route);
  const metrics = await client.evaluate(`(()=>{const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight};const controls=[...document.querySelectorAll("button,input,select,textarea,[role=button],[role=combobox],a[href]")].filter(visible).map(node=>{const rect=node.getBoundingClientRect();return{tag:node.tagName,type:node.getAttribute("type")||"",label:(node.getAttribute("aria-label")||node.textContent||node.getAttribute("placeholder")||"").trim().replace(/\\s+/g," ").slice(0,70),width:Math.round(rect.width),height:Math.round(rect.height)}}).filter(control=>!(["checkbox","radio","hidden"].includes(control.type))&&!(control.width<=2&&control.height<=2));const undersized=controls.filter(control=>control.width<44||control.height<44),text=document.body.innerText;return{path:location.pathname,viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,undersized:undersized.slice(0,30),undersizedCount:undersized.length,visibleControlCount:controls.length,desktopSidebarVisible:[...document.querySelectorAll(".app-desktop-sidebar")].some(visible),genericFailure:/something went wrong|unexpected error|page failed to load/i.test(text),stuckLoading:/loading(?:\\.{3}|…)?$/im.test(text.trim()),runtimeErrors:window.__arthaQaErrors||[]}})()`);
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${qaId.toLowerCase()}-${width}x${height}.png`;
  // Developers may run build/cleanup tasks alongside this long matrix; recreate
  // the ignored artifact directory before each durable write.
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(image.data, "base64"));
  assert(metrics.path === route, `${qaId} redirected from ${route} to ${metrics.path}`);
  assert(metrics.documentWidth <= width + 1 && metrics.bodyWidth <= width + 1, `${qaId} ${width}px horizontal overflow: ${JSON.stringify(metrics)}`);
  assert(!metrics.desktopSidebarVisible, `${qaId} ${width}px shows desktop sidebar`);
  assert(!metrics.genericFailure, `${qaId} ${width}px rendered an error boundary`);
  assert(!metrics.stuckLoading, `${qaId} ${width}px remained in a loading state`);
  assert(metrics.runtimeErrors.length === 0, `${qaId} ${width}px runtime errors: ${metrics.runtimeErrors.join(" | ")}`);
  return { qaId, route, width, height, ...metrics, screenshot: filename };
}

async function main() {
  await mkdir(OUTPUT_DIR, { recursive: true });
  await mkdir(PROFILE_DIR, { recursive: true });
  await waitFor(`${API_URL.replace(/\/api$/, "")}/health/ready`); await waitFor(FRONTEND_URL);
  const chrome = spawn(CHROME_PATH, ["--headless=new", "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check", `--remote-debugging-port=${DEBUG_PORT}`, `--user-data-dir=${PROFILE_DIR}`, `${FRONTEND_URL}/manifest.webmanifest`], { windowsHide: true, stdio: "ignore" });
  let client;
  try {
    await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`);
    const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json(), target = targets.find((item) => item.type === "page" && item.url.startsWith(FRONTEND_URL));
    assert(target, "Chrome did not create the application page");
    client = new CdpClient(target.webSocketDebuggerUrl); await client.connect(); await client.send("Page.enable"); await client.send("Runtime.enable");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__arthaQaErrors=[];window.addEventListener("error",event=>window.__arthaQaErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener("unhandledrejection",event=>window.__arthaQaErrors.push(String(event.reason?.stack||event.reason)));` });

    const results = [];
    for (const { trade, routes, records } of VERTICALS) {
      await prepareAppOrigin(client);
      await startTradeSession(client, trade, records);
      for (const [qaId, route] of routes) {
        for (const [width, height] of VIEWPORTS) results.push({ trade, ...await auditPage(client, qaId, route, width, height) });
      }
    }

    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, results }, null, 2));
    const undersized = results.filter((result) => result.undersizedCount > 0);
    assert(undersized.length === 0, `${undersized.length}/${results.length} captures contain controls below 44x44; inspect ${path.join(OUTPUT_DIR, "report.json")}`);
    console.log(`Vertical mobile matrix passed ${results.length}/${results.length} captures across ${VERTICALS.length} trades. Artifacts: ${OUTPUT_DIR}`);
  } finally { await closeChrome(client, chrome); }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
