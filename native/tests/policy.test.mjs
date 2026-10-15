import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { validateApiBase, assetPath, isAppUrl, externalUrl } = createRequire(import.meta.url)('../desktop/policy.cjs');
test('only the fixed HTTPS API configuration is accepted', () => {
  assert.equal(validateApiBase('https://example.com/api/'), 'https://example.com/api');
  for (const value of ['http://example.com/api', 'https://user:pass@example.com/api', 'https://example.com/api?target=x', 'https://localhost/api', 'file:///api']) assert.throws(() => validateApiBase(value));
});
test('packaged files cannot escape their directory', () => {
  assert.equal(assetPath('/bundle', '/assets/app.js'), '/bundle/assets/app.js');
  for (const value of ['/../secret', '/%2e%2e/secret', '/%5c..%5csecret', '/%00', '/%zz']) assert.equal(assetPath('/bundle', value), null);
});
test('navigation and external links never enable script/file execution', () => {
  assert.equal(isAppUrl('kirana://app/billing'), true);
  for (const value of ['https://app', 'kirana://evil/billing', 'kirana://user@app', 'kirana://app:42']) assert.equal(isAppUrl(value), false);
  assert.equal(externalUrl('https://example.com/help'), 'https://example.com/help');
  for (const value of ['javascript:alert(1)', 'file:///etc/passwd', 'https://user:pass@example.com']) assert.equal(externalUrl(value), null);
});
