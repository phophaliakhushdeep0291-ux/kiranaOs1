import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const FRONTEND_URL = process.env.QA_FRONTEND_URL || "http://127.0.0.1:5173";
const FRONTEND_ORIGIN = new URL(FRONTEND_URL).origin;
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9482);
const OUTPUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || "qa-artifacts/mobile-core-matrix");
const PROFILE_DIR = path.resolve(process.env.QA_PROFILE_DIR || path.join(tmpdir(), "artha-mobile-core-matrix-profile"));
const VIEWPORTS = [[375, 667], [390, 844], [430, 932], [768, 1024]];
const ALL_ROUTES = [
  ["MQA-BILL-01", "/billing"], ["MQA-PROD-01", "/products"],
  ["MQA-CUST-01", "/customers"], ["MQA-INV-01", "/inventory"],
  ["MQA-PUR-01", "/purchase-bills"], ["MQA-RPT-01", "/reports"],
  ["MQA-SET-01", "/settings"], ["MQA-SYNC-01", "/sync-status"],
  // /udhar is the one-tap khata entry point. It is an alias, so the third element is
  // where it must land — measuring it still earns its place next to MQA-CUST-01
  // because ?filter=udhar renders a different list (only customers who owe).
  ["MQA-UDHAR-01", "/udhar", "/customers", "?filter=udhar"],
];
const ROUTE_FILTER = String(process.env.QA_ROUTE_FILTER || "").split(",").map((value) => value.trim()).filter(Boolean);
const ROUTES = ROUTE_FILTER.length
  ? ALL_ROUTES.filter(([qaId, route]) => ROUTE_FILTER.includes(qaId) || ROUTE_FILTER.includes(route))
  : ALL_ROUTES;
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
  const state = await client.evaluate(`({href:location.href,text:document.body?.innerText?.slice(0,1200),technicalDetails:[...document.querySelectorAll("details pre")].map(node=>node.textContent?.trim()).filter(Boolean).slice(0,5),errors:window.__arthaQaErrors||[]})`).catch(() => null);
  throw new Error(`Page condition timed out: ${expression}; ${JSON.stringify(state)}`);
}

async function navigate(client, route, expectedPath = route, expectedSearch = "") {
  await client.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  // An alias route settles on its destination, not on the URL we asked for.
  await waitForPage(client, `document.readyState === "complete" && location.pathname === ${JSON.stringify(expectedPath)} && location.search === ${JSON.stringify(expectedSearch)}`);
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 30`);
  await waitForPage(client, `!document.querySelector(".app-loading-surface") && Boolean(document.querySelector(".app-route-ready"))`);
  await sleep(900);
}

async function prepareAppOrigin(client) {
  // Use a same-origin static document so the application cannot clear an old
  // session while the harness is still deciding whether to verify or refresh it.
  await client.send("Page.navigate", { url: `${FRONTEND_URL}/manifest.webmanifest` });
  await waitForPage(
    client,
    `document.readyState === "complete" && location.origin === ${JSON.stringify(FRONTEND_ORIGIN)}`,
  );
  await waitForPage(client, `document.body && document.body.innerText.trim().length > 20`);
}

async function ensureSession(client) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`, mobile = `8${runId.slice(-9)}`;
  const outcome = await client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},sessionKey="kiranaos.auth.session.v1",mobileKey="kiranaos.qa.mobile",password="Test@12345";
    let deviceId=localStorage.getItem("kiranaos_device_id")||localStorage.getItem("kirana-os:device-id:v1");
    if(!deviceId){deviceId="mobile_matrix_"+crypto.randomUUID();localStorage.setItem("kiranaos_device_id",deviceId);localStorage.setItem("kirana-os:device-id:v1",deviceId)}
    let stored={};try{stored=JSON.parse(localStorage.getItem(sessionKey)||"{}")||{}}catch{}
    const save=(auth)=>{const session={accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop};localStorage.setItem("kiranaApiBaseUrl",apiUrl);localStorage.setItem(sessionKey,JSON.stringify(session));sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));return session};
    const verify=async(session)=>{if(!session?.accessToken)return false;const response=await fetch(apiUrl+"/auth/me",{headers:{authorization:"Bearer "+session.accessToken,"x-device-id":deviceId}});return response.ok};
    if(await verify(stored)){sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));return "reused"}
    if(stored.refreshToken){const response=await fetch(apiUrl+"/auth/refresh",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({refreshToken:stored.refreshToken})});if(response.ok){const json=await response.json(),session=save(json.data??json);if(await verify(session))return "refreshed"}}
    const knownMobile=localStorage.getItem(mobileKey)||stored.user?.mobile||stored.user?.phone||"";
    if(knownMobile){const response=await fetch(apiUrl+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({mobile:knownMobile,password})});const json=await response.json();if(!response.ok)throw new Error("QA login failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,knownMobile);return "logged-in"}
    const qaMobile=${JSON.stringify(mobile)},response=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"Mobile Matrix QA",ownerName:"QA Owner",city:"Jaipur",address:"Automated QA",mobile:qaMobile,password,ownerPin:"2468"})}),json=await response.json();
    if(!response.ok)throw new Error("Registration failed: "+JSON.stringify(json));save(json.data??json);localStorage.setItem(mobileKey,qaMobile);return "registered"
  })()`);
  console.log(`QA auth session: ${outcome}`);
  return outcome;
}

async function closeChrome(client, chrome) {
  if (client) {
    await client.send("Browser.close").catch(() => {});
    client.close();
  }
  if (chrome.exitCode === null) {
    await Promise.race([
      new Promise((resolve) => chrome.once("exit", resolve)),
      sleep(5_000),
    ]);
  }
  if (chrome.exitCode === null) chrome.kill();
}

async function auditPage(client, qaId, route, width, height, expectedPath = route, expectedSearch = "") {
  await client.send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: true });
  await navigate(client, route, expectedPath, expectedSearch);
  const metrics = await client.evaluate(`(()=>{const visible=node=>{const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0&&rect.bottom>0&&rect.top<innerHeight};const controls=[...document.querySelectorAll("button,input,select,textarea,[role=button],[role=combobox],a[href]")].filter(visible).map(node=>{const rect=node.getBoundingClientRect();return{tag:node.tagName,type:node.getAttribute("type")||"",label:(node.getAttribute("aria-label")||node.textContent||node.getAttribute("placeholder")||"").trim().replace(/\\s+/g," ").slice(0,70),width:Math.round(rect.width),height:Math.round(rect.height)}}).filter(control=>!(["checkbox","radio","hidden"].includes(control.type))&&!(control.width<=2&&control.height<=2));const undersized=controls.filter(control=>control.width<44||control.height<44),text=document.body.innerText;return{path:location.pathname,viewport:[innerWidth,innerHeight],documentWidth:document.documentElement.scrollWidth,bodyWidth:document.body.scrollWidth,undersized:undersized.slice(0,30),undersizedCount:undersized.length,visibleControlCount:controls.length,desktopSidebarVisible:[...document.querySelectorAll(".app-desktop-sidebar")].some(visible),genericFailure:/something went wrong|unexpected error|page failed to load/i.test(text),stuckLoading:/loading(?:\\.{3}|…)?$/im.test(text.trim()),runtimeErrors:window.__arthaQaErrors||[]}})()`);
  const accessibility = await client.evaluate(`(()=>{
    const visible=(node)=>{if(node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0&&(rect.width>0||rect.height>0)&&rect.bottom>0&&rect.top<innerHeight&&rect.right>0&&rect.left<innerWidth};
    const text=(node)=>(node?.textContent||"").replace(/\\s+/g," ").trim();
    const name=(node)=>{const direct=(node.getAttribute("aria-label")||"").trim();if(direct)return direct;const ids=(node.getAttribute("aria-labelledby")||"").trim().split(/\\s+/).filter(Boolean),byIds=ids.map(id=>text(document.getElementById(id))).join(" ").trim();if(byIds)return byIds;if("labels" in node&&node.labels?.length){const byLabels=[...node.labels].map(text).join(" ").trim();if(byLabels)return byLabels}const child=node.querySelector?.("[aria-label]")?.getAttribute("aria-label");return(node.getAttribute("alt")||node.getAttribute("title")||child||text(node)||"").trim()};
    const issues=[],add=(rule,node,detail)=>issues.push({rule,tag:node?.tagName?.toLowerCase()||"document",text:node?text(node).slice(0,80):"",detail});
    if(!document.title.trim())add("document-title",null,"missing title");if(!document.documentElement.lang.trim())add("html-lang",document.documentElement,"missing language");
    const mains=[...document.querySelectorAll("main")].filter(visible);if(mains.length!==1)add("main-landmark",null,"expected 1 visible main, found "+mains.length);
    const h1s=[...document.querySelectorAll('h1,[role=heading][aria-level="1"]')].filter(visible);if(h1s.length!==1)add("page-h1",null,"expected 1 visible level-1 heading, found "+h1s.length);
    const headings=[...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading][aria-level]')].filter(visible);let previous=0;for(const heading of headings){const level=heading.tagName[0]==="H"?Number(heading.tagName.slice(1)):Number(heading.getAttribute("aria-level"));if(previous&&level>previous+1)add("heading-order",heading,"jumped from h"+previous+" to h"+level);previous=level}
    const ids=new Map();for(const node of document.querySelectorAll("[id]")){if(node.id)ids.set(node.id,(ids.get(node.id)||0)+1)}for(const [id,count] of ids)if(count>1)add("duplicate-id",document.getElementById(id),"#"+id+" appears "+count+" times");
    for(const node of document.querySelectorAll("[aria-labelledby],[aria-describedby],[aria-controls]")){if(!visible(node))continue;for(const attr of ["aria-labelledby","aria-describedby","aria-controls"]){const value=node.getAttribute(attr);if(value)for(const id of value.trim().split(/\\s+/))if(id&&!document.getElementById(id))add("broken-aria-reference",node,attr+" references #"+id)}}
    for(const node of document.querySelectorAll("button,a[href],[role=button],[role=link]"))if(visible(node)&&!name(node))add("interactive-name",node,"visible control has no accessible name");
    for(const node of document.querySelectorAll("input:not([type=hidden]),select,textarea"))if(visible(node)&&!name(node))add("form-label",node,"visible form control has no associated label");
    for(const node of document.querySelectorAll("img"))if(visible(node)&&!node.hasAttribute("alt"))add("image-alt",node,"visible image has no alt attribute");
    for(const hidden of document.querySelectorAll('[aria-hidden="true"]')){const focusable=[...hidden.querySelectorAll("button,a[href],input,select,textarea,[tabindex]")].filter(node=>node.tabIndex>=0&&!node.closest("[inert]"));if(focusable.length)add("aria-hidden-focus",hidden,focusable.length+" focusable descendants without inert")}
    return{issueCount:issues.length,issues:issues.slice(0,40),h1Count:h1s.length,headingCount:headings.length};
  })()`);
  metrics.accessibility = accessibility;
  const axe = await client.evaluate(`axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]},resultTypes:["violations"]}).then(result=>({
    violationCount:result.violations.length,
    violations:result.violations.map(rule=>({id:rule.id,impact:rule.impact,help:rule.help,nodes:rule.nodes.slice(0,12).map(node=>({target:node.target,html:node.html.slice(0,240),failureSummary:node.failureSummary}))}))
  }))`);
  metrics.axe = axe;
  const image = await client.send("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  const filename = `${qaId.toLowerCase()}-${width}x${height}.png`;
  // Developers may run build/cleanup tasks alongside this long matrix; recreate
  // the ignored artifact directory before each durable write.
  await mkdir(OUTPUT_DIR, { recursive: true });
  await writeFile(path.join(OUTPUT_DIR, filename), Buffer.from(image.data, "base64"));
  assert(metrics.path === expectedPath, `${qaId} redirected from ${route} to ${metrics.path}`);
  assert(await client.evaluate(`location.search`) === expectedSearch, `${qaId} lost the expected query ${expectedSearch}`);
  assert(metrics.documentWidth <= width + 1 && metrics.bodyWidth <= width + 1, `${qaId} ${width}px horizontal overflow: ${JSON.stringify(metrics)}`);
  assert(!metrics.desktopSidebarVisible, `${qaId} ${width}px shows desktop sidebar`);
  assert(!metrics.genericFailure, `${qaId} ${width}px rendered an error boundary`);
  assert(!metrics.stuckLoading, `${qaId} ${width}px remained in a loading state`);
  assert(metrics.runtimeErrors.length === 0, `${qaId} ${width}px runtime errors: ${metrics.runtimeErrors.join(" | ")}`);
  assert(metrics.accessibility.issueCount === 0, `${qaId} ${width}px accessibility issues: ${JSON.stringify(metrics.accessibility.issues)}`);
  assert(metrics.axe.violationCount === 0, `${qaId} ${width}px axe WCAG violations: ${JSON.stringify(metrics.axe.violations)}`);
  return { qaId, route, width, height, ...metrics, screenshot: filename };
}

async function auditUdharSpaTransition(client) {
  await client.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 1, mobile: true });
  await navigate(client, "/customers");
  await waitForPage(client, `document.querySelector('[data-customer-filter="all"]')?.getAttribute("aria-pressed") === "true"`);
  // Wouter's navigation function uses this same patched history method. This
  // proves the alias transition without Page.navigate/full reload hiding a
  // stale CustomersPage state initializer.
  await client.evaluate(`history.pushState(null,"","/udhar")`);
  await waitForPage(client, `location.pathname === "/customers" && location.search === "?filter=udhar"`);
  await waitForPage(client, `document.querySelector('[data-customer-filter="udhar"]')?.getAttribute("aria-pressed") === "true"`);
  const state = await client.evaluate(`({path:location.pathname,search:location.search,activeFilter:document.querySelector('[data-customer-filter][aria-pressed="true"]')?.getAttribute("data-customer-filter")||null})`);
  assert(state.activeFilter === "udhar", `SPA transition left the wrong customer filter active: ${JSON.stringify(state)}`);
  return state;
}

async function pressTab(client, shift = false) {
  const modifiers = shift ? 8 : 0;
  await client.send("Input.dispatchKeyEvent", {
    type: "keyDown", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9, modifiers,
  });
  await client.send("Input.dispatchKeyEvent", {
    type: "keyUp", key: "Tab", code: "Tab", windowsVirtualKeyCode: 9,
    nativeVirtualKeyCode: 9, modifiers,
  });
  await sleep(25);
}

async function auditKeyboardRoute(client, qaId, route, expectedPath = route, expectedSearch = "") {
  await client.send("Emulation.setDeviceMetricsOverride", {
    width: 1280, height: 800, deviceScaleFactor: 1, mobile: false,
  });
  await navigate(client, route, expectedPath, expectedSearch);
  const expected = await client.evaluate(`(()=>{
    const visible=(node)=>{if(node.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const style=getComputedStyle(node),rect=node.getBoundingClientRect();return style.display!=="none"&&style.visibility!=="hidden"&&Number(style.opacity||1)>0&&rect.width>0&&rect.height>0};
    const candidates=[...document.querySelectorAll('a[href],button,input,select,textarea,summary,[contenteditable]:not([contenteditable="false"]),[tabindex]')].filter(node=>visible(node)&&!node.disabled&&node.getAttribute('aria-disabled')!=="true"&&node.tabIndex>=0);
    const radios=new Map();for(const node of candidates){if(node instanceof HTMLInputElement&&node.type==="radio"&&node.name){const key=(node.form?.id||"")+"::"+node.name;if(!radios.has(key))radios.set(key,[]);radios.get(key).push(node)}}
    const sequential=candidates.filter(node=>{if(!(node instanceof HTMLInputElement)||node.type!=="radio"||!node.name)return true;const key=(node.form?.id||"")+"::"+node.name,group=radios.get(key)||[];return group.find(item=>item.checked)===node||(!group.some(item=>item.checked)&&group[0]===node)});
    return sequential.map((node,index)=>{node.dataset.qaKeyboardId=${JSON.stringify(qaId)}+"-"+index;const rawName=(node.getAttribute("aria-label")||node.getAttribute("title")||node.textContent||node.getAttribute("placeholder")||"").replace(/\\s+/g," ").trim().slice(0,100);return{id:node.dataset.qaKeyboardId,tag:node.tagName.toLowerCase(),type:node.getAttribute("type")||"",role:node.getAttribute("role")||"",href:node.getAttribute("href")||"",rawName,name:rawName,html:node.outerHTML.slice(0,240)}});
  })()`);
  assert(expected.length > 0, `${qaId} exposes no keyboard-reachable controls`);
  const expectedIds = expected.map((control) => control.id);
  await client.evaluate(`document.activeElement instanceof HTMLElement&&document.activeElement.blur()`);
  const visited = [], focusStates = [];
  let browserBoundaryCount = 0;
  for (let index = 0; index < Math.min(expected.length + 30, 280); index += 1) {
    await pressTab(client);
    const state = await client.evaluate(`(()=>{const node=document.activeElement;if(!(node instanceof HTMLElement))return null;const text=(value)=>(value||"").replace(/\\s+/g," ").trim();const ids=text(node.getAttribute("aria-labelledby")).split(/\\s+/).filter(Boolean),labelled=ids.map(id=>text(document.getElementById(id)?.textContent)).join(" ").trim(),labels="labels" in node&&node.labels?[...node.labels].map(label=>text(label.textContent)).join(" ").trim():"",rawName=(text(node.getAttribute("aria-label"))||text(node.getAttribute("title"))||text(node.textContent)||text(node.getAttribute("placeholder"))).slice(0,100),name=text(node.getAttribute("aria-label"))||labelled||labels||text(node.getAttribute("alt"))||text(node.getAttribute("title"))||text(node.textContent)||text(node.getAttribute("placeholder"));const style=getComputedStyle(node),rect=node.getBoundingClientRect(),hidden=Boolean(node.closest('[hidden],[inert],[aria-hidden="true"]'))||style.display==="none"||style.visibility==="hidden"||Number(style.opacity||1)===0;const indicator=(style.outlineStyle!=="none"&&parseFloat(style.outlineWidth)>0)||style.boxShadow!=="none";if(!node.dataset.qaKeyboardId)node.dataset.qaKeyboardId=${JSON.stringify(qaId)}+"-runtime-"+Math.random().toString(36).slice(2);return{id:node.dataset.qaKeyboardId,tag:node.tagName.toLowerCase(),type:node.getAttribute("type")||"",role:node.getAttribute("role")||"",href:node.getAttribute("href")||"",rawName,name:name.slice(0,100),hidden,focusVisible:node.matches(":focus-visible"),indicator,rect:{width:Math.round(rect.width),height:Math.round(rect.height)}}})()`);
    // Headless Chromium exposes BODY while Tab moves through browser chrome.
    // Keep traversing until focus returns to the page, then use a repeat of the
    // first control as the real cycle boundary.
    if (!state || state.tag === "body") { browserBoundaryCount += 1; continue; }
    assert(!state.hidden, `${qaId} keyboard focus entered hidden or inert content: ${JSON.stringify(state)}`);
    assert(state.name, `${qaId} keyboard focus reached an unnamed control: ${JSON.stringify(state)}`);
    assert(state.focusVisible && state.indicator, `${qaId} has no visible keyboard focus indicator: ${JSON.stringify(state)}`);
    if (visited.length > 1 && state.id === visited[0]) break;
    if (!visited.includes(state.id)) visited.push(state.id);
    focusStates.push(state);
  }
  // A background status update may replace a React control during traversal.
  // The replacement receives focus but no longer carries the temporary ID.
  // Match only such runtime nodes, one-for-one, by full semantic signature.
  const signature = (control) => JSON.stringify([control.tag, control.type, control.role, control.href, control.rawName]);
  const runtimeBySignature = new Map();
  for (const state of focusStates) {
    if (!state.id.includes("-runtime-")) continue;
    const key = signature(state), ids = runtimeBySignature.get(key) ?? new Set();
    ids.add(state.id); runtimeBySignature.set(key, ids);
  }
  const replacementBudget = new Map([...runtimeBySignature].map(([key, ids]) => [key, ids.size]));
  const directlyVisitedCount = expected.filter((control) => visited.includes(control.id)).length;
  const missing = expected.filter((control) => {
    if (visited.includes(control.id)) return false;
    const key = signature(control), remaining = replacementBudget.get(key) ?? 0;
    if (remaining > 0) { replacementBudget.set(key, remaining - 1); return false; }
    return true;
  });
  const replacedControlCount = expected.length - missing.length - directlyVisitedCount;
  assert(missing.length === 0, `${qaId} keyboard traversal missed ${missing.length}/${expected.length} controls: ${JSON.stringify(missing.slice(0,20))}`);
  assert(await client.evaluate(`location.pathname`) === expectedPath, `${qaId} keyboard traversal changed route unexpectedly`);
  assert(await client.evaluate(`location.search`) === expectedSearch, `${qaId} keyboard traversal changed query unexpectedly`);
  return { qaId, route, expectedControlCount: expectedIds.length, visitedControlCount: visited.length, replacedControlCount, browserBoundaryCount, focusStates };
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
    const axeSource = await readFile(path.resolve("node_modules/axe-core/axe.min.js"), "utf8");
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: axeSource });
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source: `window.__arthaQaErrors=[];window.addEventListener("error",event=>window.__arthaQaErrors.push(String(event.error?.stack||event.message||event.error)));window.addEventListener("unhandledrejection",event=>window.__arthaQaErrors.push(String(event.reason?.stack||event.reason)));` });
    await prepareAppOrigin(client);
    await ensureSession(client);
    const results = [];
    for (const [qaId, route, expectedPath, expectedSearch] of ROUTES) for (const [width, height] of VIEWPORTS) results.push(await auditPage(client, qaId, route, width, height, expectedPath ?? route, expectedSearch ?? ""));
    const statefulChecks = ROUTES.some(([, route]) => route === "/customers" || route === "/udhar")
      ? { udharSpaTransition: await auditUdharSpaTransition(client) }
      : {};
    const keyboardResults = [];
    for (const [qaId, route, expectedPath, expectedSearch] of ROUTES) {
      keyboardResults.push(await auditKeyboardRoute(client, qaId, route, expectedPath ?? route, expectedSearch ?? ""));
    }
    await mkdir(OUTPUT_DIR, { recursive: true });
    await writeFile(path.join(OUTPUT_DIR, "report.json"), JSON.stringify({ generatedAt: new Date().toISOString(), frontendUrl: FRONTEND_URL, apiUrl: API_URL, results, statefulChecks, keyboardResults }, null, 2));
    const undersized = results.filter((result) => result.undersizedCount > 0);
    assert(undersized.length === 0, `${undersized.length}/${results.length} captures contain controls below 44x44; inspect ${path.join(OUTPUT_DIR, "report.json")}`);
    console.log(`Mobile core matrix passed ${results.length}/${results.length} captures and ${keyboardResults.length}/${keyboardResults.length} keyboard routes. Artifacts: ${OUTPUT_DIR}`);
  } finally { await closeChrome(client, chrome); }
}

main().catch((error) => { console.error(error.stack ?? error); process.exitCode = 1; });
