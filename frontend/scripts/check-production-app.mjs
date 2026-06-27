import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(repoRoot, "public");

const failures = [];

function fail(message) {
  failures.push(message);
}

function readText(relativePath) {
  const absolutePath = path.join(repoRoot, relativePath);
  if (!fs.existsSync(absolutePath)) {
    fail(`${relativePath} is missing`);
    return "";
  }
  return fs.readFileSync(absolutePath, "utf8");
}

function requirePublicFile(publicPath) {
  const normalized = publicPath.replace(/^\/+/, "");
  const absolutePath = path.join(publicRoot, normalized);
  if (!fs.existsSync(absolutePath)) {
    fail(`public/${normalized} is missing`);
    return;
  }
  const { size } = fs.statSync(absolutePath);
  if (size <= 0) fail(`public/${normalized} is empty`);
}

function parseManifest() {
  const raw = readText("public/manifest.webmanifest");
  if (!raw) return undefined;
  try {
    return JSON.parse(raw);
  } catch (error) {
    fail(`public/manifest.webmanifest is invalid JSON: ${error.message}`);
    return undefined;
  }
}

function checkManifest() {
  const manifest = parseManifest();
  if (!manifest) return;

  for (const key of ["id", "name", "short_name", "start_url", "scope", "display", "theme_color", "background_color"]) {
    if (!manifest[key]) fail(`manifest is missing ${key}`);
  }

  if (manifest.display !== "standalone" && manifest.display !== "fullscreen" && manifest.display !== "minimal-ui") {
    fail(`manifest display should be installable, received "${manifest.display}"`);
  }

  if (!Array.isArray(manifest.icons) || manifest.icons.length < 3) {
    fail("manifest needs SVG plus 192/512 PNG icons");
    return;
  }

  const iconSizes = new Set();
  let hasMaskable = false;
  for (const icon of manifest.icons) {
    if (!icon.src || !icon.type || !icon.sizes) fail(`manifest has an incomplete icon: ${JSON.stringify(icon)}`);
    if (icon.src) requirePublicFile(icon.src);
    if (typeof icon.sizes === "string") iconSizes.add(icon.sizes);
    if (String(icon.purpose ?? "").includes("maskable")) hasMaskable = true;
  }

  if (![...iconSizes].some((size) => size.includes("192x192"))) fail("manifest needs a 192x192 PNG icon");
  if (![...iconSizes].some((size) => size.includes("512x512"))) fail("manifest needs a 512x512 PNG icon");
  if (!hasMaskable) fail("manifest needs a maskable icon for Android install surfaces");

  if (!Array.isArray(manifest.shortcuts) || manifest.shortcuts.length < 3) {
    fail("manifest should expose key app shortcuts");
  }
}

function checkHtmlShell() {
  const html = readText("index.html");
  if (!html) return;

  for (const marker of [
    'rel="manifest"',
    'name="theme-color"',
    'mobile-web-app-capable',
    'apple-mobile-web-app-capable',
    'rel="apple-touch-icon"',
  ]) {
    if (!html.includes(marker)) fail(`index.html is missing ${marker}`);
  }

  const iconMatch = html.match(/<link[^>]+rel="icon"[^>]+href="([^"]+)"/i);
  if (!iconMatch) fail("index.html is missing a favicon link");
  else requirePublicFile(iconMatch[1]);

  const appleIconMatch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/i);
  if (!appleIconMatch) fail("index.html is missing an apple touch icon link");
  else requirePublicFile(appleIconMatch[1]);
}

function checkServiceWorker() {
  const sw = readText("public/sw.js");
  if (!sw) return;

  for (const marker of ["CACHE_VERSION", "APP_SHELL", "offline.html", "networkFirstNavigation", "NEVER_CACHE_PATTERNS"]) {
    if (!sw.includes(marker)) fail(`service worker is missing ${marker}`);
  }

  for (const sensitivePattern of ["/api", "/auth", "/sync", "password", "token"]) {
    if (!sw.includes(sensitivePattern)) fail(`service worker should bypass sensitive route marker ${sensitivePattern}`);
  }

  const shellMatch = sw.match(/const APP_SHELL = \[([\s\S]*?)\];/);
  if (shellMatch && /\/api|\/auth|\/sync/i.test(shellMatch[1])) {
    fail("APP_SHELL must not cache API/auth/sync routes");
  }
}

function checkPackageScripts() {
  const pkgRaw = readText("package.json");
  if (!pkgRaw) return;

  let pkg;
  try {
    pkg = JSON.parse(pkgRaw);
  } catch (error) {
    fail(`package.json is invalid JSON: ${error.message}`);
    return;
  }

  for (const script of ["build", "typecheck", "test", "bundle:check", "app:check", "prod:check"]) {
    if (!pkg.scripts?.[script]) fail(`package.json is missing scripts.${script}`);
  }
}

function checkOfflinePage() {
  const offline = readText("public/offline.html");
  if (!offline) return;
  if (!offline.includes("Internet offline")) fail("offline.html should clearly explain offline state");
  if (!offline.includes("location.reload()")) fail("offline.html should provide a retry action");
}

checkManifest();
checkHtmlShell();
checkServiceWorker();
checkPackageScripts();
checkOfflinePage();

if (failures.length > 0) {
  console.error("Production app check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Production app check passed.");
