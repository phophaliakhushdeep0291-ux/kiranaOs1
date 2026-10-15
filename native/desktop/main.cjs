const { app, BrowserWindow, session, protocol, net, dialog, systemPreferences, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { createHash } = require('node:crypto');
const { APP_ORIGIN, isAppUrl, validateApiBase, assetPath, externalUrl } = require('./policy.cjs');
const root = path.join(__dirname, '..');
const config = JSON.parse(fs.readFileSync(path.join(root, 'runtime-config.json'), 'utf8'));
if (config.target !== 'desktop') throw new Error('Prepare the desktop bundle before starting or packaging the desktop app.');
const apiBase = validateApiBase(config.apiBaseUrl);
const webRoot = path.join(root, 'web');
protocol.registerSchemesAsPrivileged([{ scheme: 'kirana', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }]);
app.setAppUserModelId('com.kiranaos.counter');
const hasLock = app.requestSingleInstanceLock();
if (!hasLock) app.quit();
let mainWindow;
app.on('second-instance', () => { if (mainWindow) { if (mainWindow.isMinimized()) mainWindow.restore(); mainWindow.focus(); } });
const trustedContents = new Set();
const mediaDecisions = new Map();
let pendingMediaPermission = null;
async function permitMedia(contents, details) {
  const mediaTypes = details.mediaTypes || [];
  if (!trustedContents.has(contents?.id) || !isAppUrl(contents.getURL()) || details.isMainFrame !== true || !isAppUrl(details.requestingUrl) || !mediaTypes.length || mediaTypes.some(t => !['audio', 'video'].includes(t))) return false;
  if (pendingMediaPermission) return false;
  pendingMediaPermission = (async () => {
    for (const kind of mediaTypes) {

      if (mediaDecisions.get(kind) !== true) {
        const label = kind === 'audio' ? 'microphone' : 'camera';
        const choice = await dialog.showMessageBox(mainWindow, { type: 'question', buttons: ['Allow', 'Cancel'], defaultId: 1, cancelId: 1, title: `Allow ${label}?`, message: `Allow KiranaOS to use your ${label}?`, detail: kind === 'audio' ? 'Recording starts only when you press a voice button. Audio is sent to your shop server for transcription.' : 'The camera is used to scan product barcodes.' });
        if (choice.response !== 0) return false;
        if (process.platform === 'darwin' && !(await systemPreferences.askForMediaAccess(label))) return false;
        mediaDecisions.set(kind, true);
      }
    }
    return true;
  })();
  try { return await pendingMediaPermission; } finally { pendingMediaPermission = null; }
}
function configureWindow(window) {
  trustedContents.add(window.webContents.id);
  window.webContents.once('destroyed', () => trustedContents.delete(window.webContents.id));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url)) event.preventDefault(); });
  window.webContents.setWindowOpenHandler(({ url }) => {
    // Receipt previews use a blank local child and write their printable HTML.
    if (url === 'about:blank' || isAppUrl(url)) return { action: 'allow', overrideBrowserWindowOptions: { webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true } } };
    const external = externalUrl(url);
    if (external) void shell.openExternal(external);
    return { action: 'deny' };
  });
  window.webContents.on('did-create-window', child => {
    child.webContents.on('will-navigate', (event, url) => { if (!isAppUrl(url) && url !== 'about:blank') event.preventDefault(); });
    child.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  });
}
function openCounter() {
  mainWindow = new BrowserWindow({ width: 1360, height: 900, minWidth: 390, minHeight: 640, title: 'KiranaOS', backgroundColor: '#f7f8fc', show: false, webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true, webSecurity: true, spellcheck: true } });
  configureWindow(mainWindow);
  mainWindow.once('ready-to-show', () => mainWindow.show());
  void mainWindow.loadURL(APP_ORIGIN + '/');
  return mainWindow;
}
const ready = app.whenReady().then(async () => {
  if (!hasLock) return;
  const ses = session.defaultSession;
  ses.setPermissionCheckHandler((contents, permission, _origin, details) => {
    if (!trustedContents.has(contents?.id) || !isAppUrl(contents.getURL()) || details.isMainFrame !== true || !isAppUrl(details.requestingUrl || details.securityOrigin || _origin)) return false;
    if (permission === 'media') return mediaDecisions.get(details.mediaType) === true;
    if (permission === 'loopback-network') return true;
    return false;
  });
  ses.setPermissionRequestHandler((contents, permission, callback, details) => {
    if (permission === 'media') void permitMedia(contents, details).then(callback, () => callback(false));
    else callback(permission === 'loopback-network' && trustedContents.has(contents?.id) && isAppUrl(contents.getURL()) && details.isMainFrame === true && isAppUrl(details.requestingUrl));
  });
  const inlineHashes = [...fs.readFileSync(path.join(webRoot, 'index.html'), 'utf8').matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)].filter(m => m[1].trim()).map(m => `'sha256-${createHash('sha256').update(m[1]).digest('base64')}'`).join(' ');
  const csp = `default-src 'self'; script-src 'self' ${inlineHashes} https://checkout.razorpay.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; font-src 'self' data: https://fonts.gstatic.com; connect-src 'self' http://127.0.0.1:* http://localhost:* https://127.0.0.1:* https://localhost:* ${new URL(apiBase).origin} https://api.razorpay.com; media-src 'self' blob:; worker-src 'self' blob:; frame-src https://api.razorpay.com; object-src 'none'; base-uri 'self'; form-action 'self'`;
  await ses.protocol.handle('kirana', async request => {
    if (!isAppUrl(request.url) || (request.initiatorOrigin && request.initiatorOrigin !== APP_ORIGIN)) return new Response('Forbidden', { status: 403 });
    const url = new URL(request.url);
    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      // Fixed origin and prefix only. No arbitrary URL/host supplied by renderer.
      const target = new URL(apiBase + url.pathname.slice(4) + url.search);
      if (target.origin !== new URL(apiBase).origin || !target.pathname.startsWith('/api/')) return new Response('Forbidden', { status: 403 });
      const headers = new Headers(request.headers);
      for (const key of ['host', 'origin', 'referer', 'cookie', 'connection']) headers.delete(key);
      try { return await net.fetch(target.href, { method: request.method, headers, body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body, duplex: 'half', redirect: 'error', bypassCustomProtocolHandlers: true }); }
      catch { return Response.json({ message: 'Cannot reach the shop server. Saved offline work remains on this device.' }, { status: 503 }); }
    }
    if (!['GET', 'HEAD'].includes(request.method)) return new Response('Method not allowed', { status: 405 });
    let file = assetPath(webRoot, url.pathname);
    if (!file) return new Response('Invalid path', { status: 400 });
    if (!path.extname(file)) file = path.join(webRoot, 'index.html');
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) return new Response('Not found', { status: 404 });
    const response = await net.fetch(pathToFileURL(file).href);
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', csp);
    headers.set('X-Content-Type-Options', 'nosniff');
    return new Response(response.body, { status: response.status, headers });
  });
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) openCounter(); });
  return openCounter();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
module.exports = { ready };
