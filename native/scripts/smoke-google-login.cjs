// Real installed renderer + main-process navigation policy, disposable profile.
// API approval is a fixture; no real Google account or production shop is used.
const { app, net, shell } = require('electron');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const proof = fs.mkdtempSync(path.join(os.tmpdir(), 'kirana-google-proof-'));
app.setPath('userData', path.join(proof, 'profile'));
const opened = [], cancelled = [];
let unavailable = true, approved = false, active, starts = 0, redeemed = 0;
shell.openExternal = async url => { opened.push(url); };
const originalFetch = net.fetch.bind(net);
net.fetch = async (input, options) => {
  if (!String(input).startsWith('https:')) return originalFetch(input, options);
  const url = new URL(String(input));
  if (url.pathname.startsWith('/api/auth/native/')) {
    const data = JSON.parse(await new Response(options.body).text());
    const action = url.pathname.split('/').at(-1);
    if (action === 'start') {
      if (unavailable) return Response.json({ success: false, error: 'Not found' }, { status: 404 });
      starts++;
      active = { ...data, requestId: String(starts).repeat(43), expiresAt: Date.now() + 300000, userCode: '12345678', intervalMs: 500 };
      return Response.json({ success: true, data: { requestId: active.requestId, expiresAt: active.expiresAt, userCode: active.userCode, intervalMs: active.intervalMs } });
    }
    assert.equal(data.verifier, active.verifier);
    assert.equal(data.requestId, active.requestId);
    if (action === 'cancel') { cancelled.push(data.requestId); return Response.json({ success: true, data: { cancelled: true } }); }
    if (action === 'poll') {
      const auth = { accessToken: 'native-google-proof-fixture', refreshToken: 'native-google-fixture-session.native-google-fixture-secret', user: { id: 'google-proof-user', shopId: 'google-proof-shop', role: 'owner', name: 'Google proof' }, shop: { id: 'google-proof-shop', name: 'Google proof shop', ownerName: 'Proof', city: 'Test', address: 'Test', settingsJson: '{}' } };
      if (approved) redeemed++;
      return Response.json({ success: true, data: approved ? { status: 'complete', auth } : { status: 'pending' } });
    }
  }
  return Response.json({ success: false, error: 'Isolated fixture' }, { status: 503 });
};
const { ready } = require('../desktop/main.cjs');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
setTimeout(() => { console.error('Google UI proof timed out'); app.exit(1); }, 45000);
(async () => {
  const window = await ready;
  window.webContents.setBackgroundThrottling(false);
  const evaluate = async expression => {
    try { return await window.webContents.executeJavaScript(expression); }
    catch (error) { throw new Error('Renderer check failed: ' + expression + '\n' + error.message); }
  };
  const until = async expression => {
    for (let n = 0; n < 100; n++) { if (await evaluate(expression)) return; await sleep(100); }
    throw new Error('UI timed out: ' + expression + '\n' + await evaluate('document.body.innerText'));
  };
  const paint = () => evaluate('new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))');
  const click = async label => {
    const point = await evaluate(`(()=>{const button=[...document.querySelectorAll('button')].find(b=>b.textContent.trim()===${JSON.stringify(label)});if(!button || button.disabled) throw new Error('Button unavailable'); const r=button.getBoundingClientRect(),p={x:Math.round(r.x+r.width/2),y:Math.round(r.y+r.height/2)};if(!button.contains(document.elementFromPoint(p.x,p.y))) throw new Error('Button covered');return p})()`);
    window.webContents.sendInputEvent({ type: 'mouseDown', button: 'left', clickCount: 1, ...point });
    window.webContents.sendInputEvent({ type: 'mouseUp', button: 'left', clickCount: 1, ...point });
  };
  await sleep(2000);
  await evaluate(`localStorage.setItem('kirana-os:ui-language:v1','en')`);
  await window.loadURL('kirana://app/login');
  await until(`document.body.innerText.includes('Continue with Google')`);
  await paint();
  fs.writeFileSync(path.join(proof, 'google-login-visible.png'), (await window.webContents.capturePage()).toPNG());
  await click('Continue with Google');
  await until(`document.body.innerText.includes('needs a server update')`);
  assert.equal(opened.length, 0, 'Unavailable backend must not open a dead browser flow');
  unavailable = false;
  await click('Continue with Google');
  await until(`Boolean(document.querySelector('[data-testid="native-login-code"]'))`);
  await paint();
  fs.writeFileSync(path.join(proof, 'google-login-code.png'), (await window.webContents.capturePage()).toPNG());
  assert.equal(opened[0], 'https://kirana-os1.vercel.app/native-sign-in#' + '1'.repeat(43));
  assert.ok(!opened[0].includes(active.verifier) && !opened[0].includes(active.userCode));
  assert.equal(await evaluate('location.origin'), 'kirana://app');
  await click('Cancel Google sign-in');
  await sleep(700);
  assert.equal(cancelled.length, 1);
  assert.equal(await evaluate(`Boolean(localStorage.getItem('kiranaos.auth.session.v1'))`), false);
  await click('Continue with Google');
  await until(`Boolean(document.querySelector('[data-testid="native-login-code"]'))`);
  approved = true;
  await until(`location.pathname === '/dashboard'`);
  assert.equal(redeemed, 1);
  assert.equal(await evaluate(`JSON.parse(localStorage.getItem('kiranaos.auth.session.v1')).user.id`), 'google-proof-user');
  await paint();
  fs.writeFileSync(path.join(proof, 'google-login-complete-fixture.png'), (await window.webContents.capturePage()).toPNG());
  const result = { passed: true, googleButtonVisible: true, actualClickOpensSystemBrowser: true, noSecretsInUrl: true, unavailableServerExplained: true, cancelRevokesRequest: true, fixtureApprovalSignsInApp: true, productionGoogleSignInTested: false, starts, redeemed };
  fs.writeFileSync(path.join(proof, 'result.json'), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result));
  console.log('Evidence:', proof);
  app.exit(0);
})().catch(error => { console.error(error); app.exit(1); });
