const path = require('node:path');
const APP_ORIGIN = 'kirana://app';
function isAppUrl(value) {
  try { const url = new URL(value); return url.protocol === 'kirana:' && url.hostname === 'app' && !url.port && !url.username && !url.password; }
  catch { return false; }
}
function validateApiBase(value) {
  const url = new URL(value);
  if (url.protocol !== 'https:' || url.username || url.password || url.hash || url.search || url.pathname.replace(/\/$/, '') !== '/api') throw new Error('The native API must be an HTTPS /api URL without credentials, query or fragment.');
  if (/^(localhost|127\.|0\.|\[?::1\]?)/i.test(url.hostname)) throw new Error('Release apps require a remote HTTPS API.');
  return url.href.replace(/\/$/, '');
}
function assetPath(root, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) return null;
  const result = path.resolve(root, '.' + decoded);
  const relative = path.relative(root, result);
  return relative.startsWith('..') || path.isAbsolute(relative) ? null : result;
}
function externalUrl(value) {
  try { const url = new URL(value); return ['https:', 'mailto:', 'tel:'].includes(url.protocol) && !url.username && !url.password ? url.href : null; }
  catch { return null; }
}
module.exports = { APP_ORIGIN, isAppUrl, validateApiBase, assetPath, externalUrl };
