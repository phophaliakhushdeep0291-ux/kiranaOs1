# KiranaOS Production App

KiranaOS ships as an installable PWA. This keeps the local-first IndexedDB behavior intact while allowing Chrome, Edge, Android, and supported desktop browsers to install it like an app.

## App Assets

- Manifest: `public/manifest.webmanifest`
- Service worker: `public/sw.js`
- Offline fallback: `public/offline.html`
- Icons: `public/favicon.svg`, `public/icons/icon-192.png`, `public/icons/icon-512.png`, `public/icons/maskable-512.png`

## Production Check

Run this before deployment:

```bash
npm run prod:check
```

That runs typecheck, tests, production build, bundle guard, and the PWA app-shell check.

For only the installable app checks:

```bash
npm run app:check
```

## Deploy Notes

- Keep `VITE_API_BASE_URL` pointed at the production backend.
- Serve over HTTPS; browsers require HTTPS for service workers and install prompts.
- The service worker caches only the app shell and static assets. API, auth, sync, token, and password routes are intentionally never cached.
- After deploy, open the app once online on each device so the app shell is available when the shop later goes offline.
