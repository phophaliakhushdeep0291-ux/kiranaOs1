/**
 * Production static file server for KiranaOS frontend.
 * Add this import to app.js when deploying as a monolith:
 *
 *   import './serve-frontend.js';
 *
 * This serves the frontend from /public folder.
 * In production, copy kiranaos-frontend/ → kiranaos-backend/public/
 */

import path from 'path';
import { fileURLToPath } from 'url';
import express from 'express';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export function serveFrontend(app) {
  const frontendPath = path.join(__dirname, '..', 'public');

  // Serve static files
  app.use(express.static(frontendPath, {
    maxAge: '1d',
    etag: true,
  }));

  // SPA fallback — for any non-API route, serve index.html
  app.get(/^(?!\/api).*/, (req, res) => {
    res.sendFile(path.join(frontendPath, 'index.html'));
  });
}
