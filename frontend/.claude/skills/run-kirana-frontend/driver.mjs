/**
 * UI/UX driver for the Artha (KiranaOS) frontend.
 *
 * Drives the REAL running app over the Chrome DevTools Protocol so an agent can
 * open any of the ~78 routes, look at it, poke it, and get a UI/UX report back.
 *
 *   node .claude/skills/run-kirana-frontend/driver.mjs goto /billing ";" shot billing
 *
 * Chrome is launched DETACHED on a fixed debug port and left running, so the
 * next invocation attaches to the same browser with the session and page state
 * still there. That gives REPL-like statefulness without needing tmux, which
 * Git Bash on Windows does not have. `quit` closes it.
 *
 * Why not reuse scripts/capture-*.mjs: those are release GATES. They assert and
 * throw on the first problem, which is right for CI and wrong for review — you
 * want to see all ten issues on a screen, not the first one. Everything here
 * reports; nothing throws on a finding.
 */
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

// .claude/skills/run-kirana-frontend -> frontend. Resolving from the driver file
// rather than cwd means these commands work from the repo root too.
const FRONTEND_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");

const FRONTEND_URL = (process.env.QA_FRONTEND_URL || "http://127.0.0.1:5174").replace(/\/$/, "");
const API_URL = process.env.QA_API_URL || "http://127.0.0.1:3000/api";
const CHROME_PATH = process.env.CHROME_PATH || "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const DEBUG_PORT = Number(process.env.QA_DEBUG_PORT || 9585);
const OUT_DIR = path.resolve(process.env.QA_OUTPUT_DIR || path.join(FRONTEND_ROOT, "qa-artifacts/uiux"));
const PROFILE_DIR = path.resolve(process.env.QA_PROFILE_DIR || path.join(tmpdir(), "artha-uiux-profile"));
const HEADFUL = process.env.QA_HEADFUL === "1";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const log = (...a) => console.log(...a);

/* ------------------------------------------------------------------ CDP --- */

class Cdp {
  constructor(url) { this.url = url; this.id = 0; this.pending = new Map(); }
  async connect() {
    this.socket = new WebSocket(this.url);
    await new Promise((res, rej) => {
      this.socket.addEventListener("open", res, { once: true });
      this.socket.addEventListener("error", rej, { once: true });
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
    const result = await this.send("Runtime.evaluate", {
      expression, awaitPromise: true, returnByValue: true, userGesture: true,
    });
    if (result.exceptionDetails) {
      throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text);
    }
    return result.result.value;
  }
  close() { try { this.socket?.close(); } catch { /* already gone */ } }
}

async function waitFor(url, timeout = 30_000, label = url) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if ((await fetch(url)).ok) return; } catch { /* still starting */ }
    await sleep(150);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

async function waitForPage(client, expression, timeout = 30_000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    if (await client.evaluate(expression).catch(() => false)) return true;
    await sleep(150);
  }
  return false;
}

/* -------------------------------------------------------------- session --- */

// A same-origin STATIC document. Seeding localStorage from about:blank writes it
// to the wrong origin; seeding from the app itself races the app's own boot,
// which can clear the session while we are still deciding whether to reuse it.
async function prepareOrigin(client) {
  const origin = new URL(FRONTEND_URL).origin;
  await client.send("Page.navigate", { url: `${FRONTEND_URL}/manifest.webmanifest` });
  await waitForPage(client, `document.readyState === "complete" && location.origin === ${JSON.stringify(origin)}`);
}

async function ensureSession(client) {
  const runId = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const mobile = `8${runId.slice(-9)}`;
  return client.evaluate(`(async()=>{
    const apiUrl=${JSON.stringify(API_URL)},sessionKey="kiranaos.auth.session.v1",mobileKey="kiranaos.qa.mobile",password="Test@12345";
    let deviceId=localStorage.getItem("kiranaos_device_id")||localStorage.getItem("kirana-os:device-id:v1");
    if(!deviceId){deviceId="uiux_"+crypto.randomUUID();localStorage.setItem("kiranaos_device_id",deviceId);localStorage.setItem("kirana-os:device-id:v1",deviceId)}
    let stored={};try{stored=JSON.parse(localStorage.getItem(sessionKey)||"{}")||{}}catch{}
    const save=(auth)=>{const s={accessToken:auth.accessToken??auth.token,refreshToken:auth.refreshToken,user:auth.user,shop:auth.shop};localStorage.setItem("kiranaApiBaseUrl",apiUrl);localStorage.setItem(sessionKey,JSON.stringify(s));sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));return s};
    const verify=async(s)=>{if(!s?.accessToken)return false;const r=await fetch(apiUrl+"/auth/me",{headers:{authorization:"Bearer "+s.accessToken,"x-device-id":deviceId}});return r.ok};
    if(await verify(stored)){sessionStorage.setItem("kiranaos.security.sessionStarted.v1",String(Date.now()));return "reused"}
    if(stored.refreshToken){const r=await fetch(apiUrl+"/auth/refresh",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({refreshToken:stored.refreshToken})});if(r.ok){const j=await r.json(),s=save(j.data??j);if(await verify(s))return "refreshed"}}
    const known=localStorage.getItem(mobileKey)||stored.user?.mobile||stored.user?.phone||"";
    if(known){const r=await fetch(apiUrl+"/auth/login",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({mobile:known,password})});const j=await r.json();if(r.ok){save(j.data??j);localStorage.setItem(mobileKey,known);return "logged-in"}}
    const qaMobile=${JSON.stringify(mobile)};
    const r=await fetch(apiUrl+"/auth/register",{method:"POST",headers:{"content-type":"application/json","x-device-id":deviceId},body:JSON.stringify({shopName:"UI/UX Review Shop",ownerName:"QA Owner",city:"Jaipur",address:"Automated UI review",mobile:qaMobile,password,ownerPin:"2468"})});
    const j=await r.json();
    if(!r.ok)throw new Error("Registration failed: "+JSON.stringify(j));
    save(j.data??j);localStorage.setItem(mobileKey,qaMobile);return "registered"
  })()`);
}

/* --------------------------------------------------------------- attach --- */

async function chromeAlive() {
  try { return (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/version`)).ok; } catch { return false; }
}

// Injected once per CDP connection. The guard matters: `instrument` also tops up
// the CURRENT document, and a second listener would double every error entry.
const ERROR_TRAP = `if(!window.__uiuxTrapped){window.__uiuxTrapped=1;window.__uiuxErrors=window.__uiuxErrors||[];addEventListener("error",e=>__uiuxErrors.push(String(e.error?.stack||e.message)));addEventListener("unhandledrejection",e=>__uiuxErrors.push(String(e.reason?.stack||e.reason)));}`;

// Page.addScriptToEvaluateOnNewDocument is scoped to the CDP CONNECTION, not to
// the browser. This driver exits after every command and reconnects on the next
// one, so that registration is gone each time — axe-core silently disappeared
// from every run after the first, and `audit` quietly reported no a11y section.
// Re-register on every attach, and inject into the page that is already open,
// because the registration alone only fires on the NEXT navigation.
async function instrument(client) {
  const axeSource = readFileSync(path.join(FRONTEND_ROOT, "node_modules/axe-core/axe.min.js"), "utf8");
  for (const source of [axeSource, ERROR_TRAP]) {
    await client.send("Page.addScriptToEvaluateOnNewDocument", { source });
  }
  if (!(await client.evaluate(`typeof axe !== "undefined"`).catch(() => false))) {
    await client.evaluate(axeSource).catch(() => {});
  }
  await client.evaluate(ERROR_TRAP).catch(() => {});
}

async function attach() {
  const targets = await (await fetch(`http://127.0.0.1:${DEBUG_PORT}/json`)).json();
  const target = targets.find((t) => t.type === "page" && t.url.startsWith(FRONTEND_URL))
    ?? targets.find((t) => t.type === "page");
  if (!target) throw new Error("Chrome is running but has no page target");
  const client = new Cdp(target.webSocketDebuggerUrl);
  await client.connect();
  await client.send("Page.enable");
  await client.send("Runtime.enable");
  await instrument(client);
  return client;
}

async function launch() {
  mkdirSync(OUT_DIR, { recursive: true });
  mkdirSync(PROFILE_DIR, { recursive: true });
  await waitFor(`${API_URL.replace(/\/api$/, "")}/health/ready`, 30_000, `backend ${API_URL}`);
  await waitFor(FRONTEND_URL, 30_000, `frontend ${FRONTEND_URL}`);

  const args = [
    HEADFUL ? "--new-window" : "--headless=new",
    "--disable-gpu", "--disable-extensions", "--no-first-run", "--no-default-browser-check",
    "--disable-features=Translate,MediaRouter",
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${PROFILE_DIR}`,
    `${FRONTEND_URL}/manifest.webmanifest`,
  ];
  // Detached + unref: Chrome outlives this node process so the NEXT invocation
  // attaches to the same browser instead of paying the boot + login cost again.
  const chrome = spawn(CHROME_PATH, args, { detached: true, stdio: "ignore", windowsHide: !HEADFUL });
  chrome.unref();
  await waitFor(`http://127.0.0.1:${DEBUG_PORT}/json/version`, 30_000, "Chrome debug port");

  const client = await attach(); // attach() instruments the connection
  await prepareOrigin(client);
  log(`session: ${await ensureSession(client)}`);
  return client;
}

async function client() {
  if (await chromeAlive()) return attach();
  return launch();
}

/* ------------------------------------------------------------- commands --- */

const READY = `!document.querySelector(".app-loading-surface") && Boolean(document.querySelector(".app-route-ready"))`;

// Git Bash (MSYS) rewrites any leading-slash argument into a Windows path before
// node ever sees it: `goto /billing` arrives as `C:/Program Files/Git/billing`,
// and the resulting URL is rejected with "Cannot navigate to invalid URL".
// The MSYS root is a real directory on disk and the route tail is not, so peel
// off the longest existing-directory prefix and keep what remains.
function normalizeRoute(input) {
  let route = String(input ?? "/").replace(/\\/g, "/");
  if (/^[A-Za-z]:\//.test(route)) {
    // Drop empty segments first: a bare `goto /` expands to the MSYS root WITH a
    // trailing slash and no tail at all, and the earlier version left that whole
    // path in place and navigated to /C:/Program%20Files/Git/.
    const parts = route.split("/").filter(Boolean);
    let cut = parts.length;
    while (cut > 1 && !existsSync(parts.slice(0, cut).join("/"))) cut -= 1;
    // Whatever survives the longest existing prefix is the route; nothing left
    // over means the argument was just "/".
    route = `/${parts.slice(cut).join("/")}`;
  }
  return route.startsWith("/") ? route : `/${route}`;
}

async function navigateOnce(c, route) {
  await c.send("Page.navigate", { url: `${FRONTEND_URL}${route}` });
  await waitForPage(c, `document.readyState === "complete"`);
  await waitForPage(c, `document.body && document.body.innerText.trim().length > 20`);
  const ready = await waitForPage(c, READY, 20_000);
  await sleep(600);
  return { ready, at: await c.evaluate(`location.pathname + location.search`) };
}

async function goto(c, rawRoute) {
  const route = normalizeRoute(rawRoute);
  let { ready, at } = await navigateOnce(c, route);
  // Bounced to /login for a route that is not /login: the stored session went
  // away (cleared, expired, or a device-limit eviction). Chrome is reused across
  // invocations but only launch() authenticates, so without this a stale browser
  // silently serves the login page to every later command until someone quits.
  if (at.startsWith("/login") && !route.startsWith("/login")) {
    log(`  bounced to /login — re-authenticating`);
    // Say WHICH thing is down. Without this the browser-side fetch surfaces as a
    // bare "TypeError: Failed to fetch", which is equally consistent with a dead
    // backend, a CORS rejection and a bad token.
    await waitFor(`${API_URL.replace(/\/api$/, "")}/health/ready`, 5_000, `backend ${API_URL} (is it running?)`);
    log(`  session: ${await ensureSession(c)}`);
    ({ ready, at } = await navigateOnce(c, route));
  }
  log(`goto ${route} -> ${at}${ready ? "" : "  [WARN: never reached .app-route-ready]"}`);
}
async function shot(c, name, full = false) {
  mkdirSync(OUT_DIR, { recursive: true });
  const image = await c.send("Page.captureScreenshot", {
    format: "png", fromSurface: true, captureBeyondViewport: full,
  });
  const file = path.join(OUT_DIR, `${(name || "shot").replace(/[^a-z0-9._-]/gi, "-")}.png`);
  writeFileSync(file, Buffer.from(image.data, "base64"));
  log(file);
}

const SIZES = {
  mobile: [390, 844], small: [375, 667], large: [430, 932],
  tablet: [768, 1024], desktop: [1280, 800], pos: [1920, 1080],
};

async function size(c, spec) {
  const preset = SIZES[spec];
  const [w, h] = preset ?? String(spec).split("x").map(Number);
  if (!w || !h) throw new Error(`bad size "${spec}" — use WxH or ${Object.keys(SIZES).join("|")}`);
  // `mobile:true` is what makes the app's own pointer/touch heuristics fire.
  await c.send("Emulation.setDeviceMetricsOverride", { width: w, height: h, deviceScaleFactor: 1, mobile: w < 768 });
  log(`size ${w}x${h} mobile=${w < 768}`);
}

// Artha keys dark mode off a `.dark` CLASS — index.css declares
// `@custom-variant dark (&:is(.dark *))` — NOT off prefers-color-scheme. Setting
// only the media feature changes nothing on screen. Worse, nothing in the product
// ever adds that class (there is no classList call in src/), so the ~206 `dark:`
// variants are unreachable today. Driving the class previews those styles; it is
// not a state a real user can currently get into.
// A full navigation drops the class, so run `theme` AFTER `goto`.
async function theme(c, mode) {
  await c.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-color-scheme", value: mode }] });
  const cls = await c.evaluate(`(()=>{document.documentElement.classList.toggle("dark",${JSON.stringify(mode)}==="dark");return document.documentElement.className||"(none)"})()`);
  log(`theme ${mode}  [html class: ${cls}]`);
}

/* The UI/UX report. Reports; never throws on a finding. */
async function audit(c) {
  const report = await c.evaluate(`(()=>{
    const vis=(n)=>{if(n.closest('[hidden],[inert],[aria-hidden="true"]'))return false;const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)>0&&r.width>0&&r.height>0};
    const label=(n)=>(n.getAttribute("aria-label")||n.textContent||n.getAttribute("placeholder")||"").replace(/\\s+/g," ").trim().slice(0,60);
    const sel=(n)=>{const id=n.id?"#"+n.id:"";const cn=(n.className&&typeof n.className==="string")?"."+n.className.trim().split(/\\s+/).slice(0,3).join("."):"";return n.tagName.toLowerCase()+id+cn};

    // The app shell sets overflow-x:clip, so a too-wide child is SLICED OFF
    // rather than making the document scroll — documentWidth stays honest-looking
    // while content is genuinely unreachable. Find the actual culprits instead.
    // An element that overflows INSIDE a horizontally scrollable ancestor is
    // reachable — a wide ledger table in an overflow-x:auto wrapper is meant to
    // scroll and is not a defect. Only content the shell silently CLIPS counts.
    const scrollableX=(n)=>{for(let p=n.parentElement;p;p=p.parentElement){const s=getComputedStyle(p);if(/auto|scroll/.test(s.overflowX)&&p.scrollWidth>p.clientWidth+1)return true}return false};
    const vw=innerWidth,bleeders=[];let reachableByScroll=0;
    for(const n of document.querySelectorAll("body *")){
      if(!vis(n))continue;
      if(scrollableX(n)){if(n.getBoundingClientRect().right>vw+1)reachableByScroll++;continue}
      const r=n.getBoundingClientRect();
      if(r.right>vw+1||r.left<-1){
        const s=getComputedStyle(n),p=n.parentElement;
        const pd=p?getComputedStyle(p).display:"";
        bleeders.push({el:sel(n),text:label(n),left:Math.round(r.left),right:Math.round(r.right),over:Math.round(r.right-vw),
          minWidth:s.minWidth,parentDisplay:pd,
          // grid/flex children default to min-width:auto, which refuses to shrink
          // below content size. That is the cause here nearly every time.
          suspectMinWidthAuto:(pd.includes("grid")||pd.includes("flex"))&&s.minWidth==="auto"});
      }
    }
    // Keep the outermost bleeders: a wide child drags its ancestors along.
    const trimmed=bleeders.filter(b=>!bleeders.some(o=>o!==b&&b.el.startsWith(o.el)&&o.over>=b.over)).slice(0,12);

    // Touch targets. On a counter POS the screen is a WIDE touchscreen, so a
    // desktop-width viewport is NOT a licence to shrink hit areas.
    const controls=[...document.querySelectorAll("button,input,select,textarea,[role=button],[role=combobox],[role=tab],a[href]")]
      .filter(vis).filter(n=>!["checkbox","radio","hidden"].includes(n.getAttribute("type")||""))
      .map(n=>{const r=n.getBoundingClientRect(),a=getComputedStyle(n,"::after");
        // .tap-target::after paints a max(100%,44px) overlay centred on the
        // control, so a 41x17 "View all" link can still have a real 44x44 hit
        // area that getBoundingClientRect() knows nothing about. Measure the
        // overlay or every one of those controls is a false positive.
        // Chrome resolves max(100%,44px) to "44px" only for a pseudo-element
        // that actually generates a box; otherwise it hands back the unresolved
        // expression, which parseFloat reads as NaN. Take the largest px literal
        // so both forms measure the same.
        const px=(v)=>{const n=parseFloat(v);if(Number.isFinite(n))return n;
          const all=[...String(v).matchAll(/([0-9.]+)px/g)].map(m=>parseFloat(m[1]));
          return all.length?Math.max(...all):0};
        const overlay=a.content!=="none"&&a.position==="absolute";
        const w=Math.round(Math.max(r.width,overlay?px(a.width):0));
        const h=Math.round(Math.max(r.height,overlay?px(a.height):0));
        const out={el:sel(n),text:label(n),w,h};
        if(w!==Math.round(r.width)||h!==Math.round(r.height))out.rawBox=[Math.round(r.width),Math.round(r.height)];
        return out})
      .filter(x=>!(x.w<=2&&x.h<=2));
    const small=controls.filter(x=>x.w<44||x.h<44);

    // Does anything actually receive the click at a control's centre? An overlay
    // sitting on top is invisible in a screenshot and steals every tap.
    // A control scrolled out of its own scroll container is not having its
    // click stolen — it is simply scrolled away, and elementFromPoint at its
    // centre reports whatever is painted there instead. That made every
    // desktop route claim 3 stolen clicks from the sidebar, whose nav is
    // overflow-y:auto with 832px of items in 612px of space. Only test a
    // control whose centre is actually on screen inside every clipping
    // ancestor.
    // Two very different reasons a centre point is not where you can click it,
    // and collapsing them hides real bugs:
    //   scrollable ancestor (auto/scroll) -> the control is merely scrolled
    //     away and a user can reach it. Not a defect.
    //   clipping ancestor (hidden/clip)   -> the control is painted nowhere and
    //     is genuinely unreachable. That IS the defect, reported as clipped.
    const outsideOf=(p,cx,cy)=>{const b=p.getBoundingClientRect();return cx<b.left-1||cx>b.right+1||cy<b.top-1||cy>b.bottom+1};
    const reach=(n,cx,cy)=>{
      if(cx<0||cy<0||cx>innerWidth||cy>innerHeight)return "offscreen";
      for(let p=n.parentElement;p;p=p.parentElement){
        const s=getComputedStyle(p);
        const sx=/auto|scroll/.test(s.overflowY+" "+s.overflowX);
        const cl=/hidden|clip/.test(s.overflowY+" "+s.overflowX);
        if(!sx&&!cl)continue;
        if(!outsideOf(p,cx,cy))continue;
        return sx?"scrolled":"clipped";
      }
      return "visible";
    };
    const stolen=[],clipped=[];
    for(const n of [...document.querySelectorAll("button,[role=button],a[href]")].filter(vis).slice(0,80)){
      const r=n.getBoundingClientRect();
      const cx=Math.round(r.left+r.width/2),cy=Math.round(r.top+r.height/2);
      const where=reach(n,cx,cy);
      if(where==="clipped"){clipped.push({el:sel(n),text:label(n),centre:[cx,cy]});continue}
      if(where!=="visible")continue;
      const hit=document.elementFromPoint(cx,cy);
      if(hit&&hit!==n&&!n.contains(hit)&&!hit.contains(n))stolen.push({el:sel(n),text:label(n),blockedBy:sel(hit)});
    }

    const t=document.body.innerText;
    const shell=document.querySelector(".app-shell")||document.body;
    return{
      route:location.pathname+location.search,
      // Read this FIRST. An audit taken mid-render reports zero controls and
      // zero problems, which is indistinguishable from a clean page.
      appReady:Boolean(document.querySelector(".app-route-ready"))&&!document.querySelector(".app-loading-surface"),
      viewport:[innerWidth,innerHeight],
      documentWidth:document.documentElement.scrollWidth,
      shellOverflowX:getComputedStyle(shell).overflowX,
      bleeding:trimmed,
      reachableByScroll,
      touchTargets:{total:controls.length,undersized:small.length,worst:small.sort((a,b)=>a.w*a.h-b.w*b.h).slice(0,10)},
      clicksStolen:stolen.slice(0,10),
      clippedControls:clipped.slice(0,10),
      errorBoundary:/something went wrong|unexpected error|page failed to load/i.test(t),
      stuckLoading:/loading(?:\\.{3}|…)?$/im.test(t.trim()),
      runtimeErrors:(window.__uiuxErrors||[]).slice(0,5),
    };
  })()`);

  let axe = null;
  try {
    axe = await c.evaluate(`typeof axe==="undefined"?null:axe.run(document,{runOnly:{type:"tag",values:["wcag2a","wcag2aa","wcag21a","wcag21aa","wcag22aa"]},resultTypes:["violations"]}).then(r=>({violationCount:r.violations.length,violations:r.violations.map(v=>({id:v.id,impact:v.impact,help:v.help,nodes:v.nodes.length,example:v.nodes[0]?.html?.slice(0,160)}))}))`);
  } catch (error) { axe = { error: String(error.message).slice(0, 200) }; }
  report.axe = axe ?? { note: "axe-core absent on this document — run `quit` then re-run to reinject" };
  log(JSON.stringify(report, null, 2));
}

async function controls(c) {
  const list = await c.evaluate(`(()=>{const vis=(n)=>{const s=getComputedStyle(n),r=n.getBoundingClientRect();return s.display!=="none"&&s.visibility!=="hidden"&&Number(s.opacity||1)>0&&r.width>0&&r.height>0};
    return [...document.querySelectorAll("button,input,select,textarea,[role=button],[role=tab],a[href]")].filter(vis).slice(0,80).map((n,i)=>{const r=n.getBoundingClientRect();n.dataset.uiuxRef="r"+i;return{ref:"r"+i,tag:n.tagName.toLowerCase(),text:(n.getAttribute("aria-label")||n.textContent||n.getAttribute("placeholder")||"").replace(/\\s+/g," ").trim().slice(0,50),box:[Math.round(r.left),Math.round(r.top),Math.round(r.width),Math.round(r.height)]}})})()`);
  log(JSON.stringify(list, null, 2));
}

function resolve(target) {
  // r0/r1/... come from `controls`; text=... matches visible text; else CSS.
  if (/^r\d+$/.test(target)) return `document.querySelector('[data-uiux-ref="${target}"]')`;
  if (target.startsWith("text=")) {
    const needle = target.slice(5).toLowerCase();
    return `[...document.querySelectorAll("button,a[href],[role=button],[role=tab],label,summary")].find(n=>(n.textContent||"").replace(/\\s+/g," ").trim().toLowerCase().includes(${JSON.stringify(needle)}))`;
  }
  return `document.querySelector(${JSON.stringify(target)})`;
}

// A real mouse event at the element's centre, NOT node.click(). node.click()
// dispatches straight at the node and sails through any overlay covering it —
// which is exactly the bug class you are trying to catch on a touch UI.
async function click(c, target) {
  const box = await c.evaluate(`(()=>{const n=${resolve(target)};if(!n)return null;n.scrollIntoView({block:"center",inline:"center"});const r=n.getBoundingClientRect();const x=Math.round(r.left+r.width/2),y=Math.round(r.top+r.height/2);const hit=document.elementFromPoint(x,y);return{x,y,blocked:hit&&hit!==n&&!n.contains(hit)&&!hit.contains(n)?hit.tagName.toLowerCase()+"."+String(hit.className||"").split(" ")[0]:null}})()`);
  if (!box) { log(`click ${target} -> NOT FOUND`); return; }
  for (const type of ["mousePressed", "mouseReleased"]) {
    await c.send("Input.dispatchMouseEvent", { type, x: box.x, y: box.y, button: "left", clickCount: 1 });
  }
  await sleep(500);
  log(`click ${target} @${box.x},${box.y}${box.blocked ? `  [WARN: ${box.blocked} is on top and took the click]` : ""}`);
}

async function fill(c, target, value) {
  const ok = await c.evaluate(`(()=>{const n=${resolve(target)};if(!n)return false;const proto=n instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;const set=Object.getOwnPropertyDescriptor(proto,"value").set;n.focus();set.call(n,${JSON.stringify(value)});n.dispatchEvent(new Event("input",{bubbles:true}));n.dispatchEvent(new Event("change",{bubbles:true}));return true})()`);
  await sleep(300);
  log(`fill ${target} = ${JSON.stringify(value)} -> ${ok ? "ok" : "NOT FOUND"}`);
}

async function press(c, key) {
  const codes = { Enter: 13, Tab: 9, Escape: 27, Backspace: 8, ArrowDown: 40, ArrowUp: 38 };
  const code = codes[key] ?? 0;
  for (const type of ["keyDown", "keyUp"]) {
    await c.send("Input.dispatchKeyEvent", {
      type, key, code: key, windowsVirtualKeyCode: code, nativeVirtualKeyCode: code,
      text: type === "keyDown" && key === "Enter" ? "\r" : undefined,
    });
  }
  await sleep(400);
  log(`press ${key}`);
}

async function text(c, selector) {
  const value = await c.evaluate(selector
    ? `document.querySelector(${JSON.stringify(selector)})?.innerText ?? "(no match)"`
    : `document.body.innerText`);
  log(String(value).replace(/\n{3,}/g, "\n\n").slice(0, 6000));
}

/* ----------------------------------------------------------------- main --- */

const HELP = `commands (chain with " ; "):
  goto <route>          navigate + wait for .app-route-ready
  shot [name]           viewport screenshot -> ${OUT_DIR}
  shotfull [name]       full-page screenshot
  size <WxH|${Object.keys(SIZES).join("|")}>
  theme <light|dark>
  audit                 UI/UX report: bleed, touch targets, stolen clicks, axe
  controls              visible controls with r0/r1 refs for click/fill
  click <r0|css|text=>  real mouse event at centre; warns if an overlay took it
  fill <r0|css> <value>
  press <Enter|Tab|Escape|...>
  text [css]            innerText dump
  eval <js>
  errors                runtime errors captured on this page
  quit                  close the detached Chrome`;

async function main() {
  const argv = process.argv.slice(2);
  if (!argv.length || argv[0] === "help") { log(HELP); return; }

  const groups = argv.join(" ").split(/\s+;\s+/).map((g) => g.trim()).filter(Boolean);

  if (groups.length === 1 && groups[0] === "quit") {
    if (await chromeAlive()) {
      const c = await attach();
      await c.send("Browser.close").catch(() => {});
      c.close();
      log("chrome closed");
    } else log("chrome was not running");
    return;
  }

  const c = await client();
  try {
    for (const group of groups) {
      const [cmd, ...rest] = group.split(/\s+/);
      const arg = rest.join(" ");
      switch (cmd) {
        // `arg`, not rest[0]: MSYS may have expanded the route into a path that
        // contains a space ("C:/Program Files/Git/billing"), and splitting that
        // on whitespace would strand half of it.
        case "goto": await goto(c, arg || "/"); break;
        case "shot": await shot(c, rest[0]); break;
        case "shotfull": await shot(c, rest[0], true); break;
        case "size": await size(c, rest[0]); break;
        case "theme": await theme(c, rest[0]); break;
        case "audit": await audit(c); break;
        case "controls": await controls(c); break;
        case "click": await click(c, arg); break;
        case "fill": await fill(c, rest[0], rest.slice(1).join(" ")); break;
        case "press": await press(c, rest[0]); break;
        case "text": await text(c, rest[0]); break;
        case "errors": log(JSON.stringify(await c.evaluate(`window.__uiuxErrors||[]`), null, 2)); break;
        case "eval": log(JSON.stringify(await c.evaluate(arg), null, 2)); break;
        case "quit": await c.send("Browser.close").catch(() => {}); log("chrome closed"); break;
        default: log(`unknown command "${cmd}"\n\n${HELP}`);
      }
    }
  } finally {
    c.close();
  }
}

main().catch((error) => { console.error(`\n${error.message}\n`); process.exit(1); });
