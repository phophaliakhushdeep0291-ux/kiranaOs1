import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));

const rawPort = process.env.PORT ?? "5173";
const port = Number(rawPort);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const rawBasePath = process.env.BASE_PATH ?? "/";
const basePath = rawBasePath.startsWith("/") ? rawBasePath : `/${rawBasePath}`;
const buildId =
  process.env.KIRANA_BUILD_ID ||
  process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.RAILWAY_GIT_COMMIT_SHA?.slice(0, 12) ||
  process.env.GITHUB_SHA?.slice(0, 12) ||
  new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 14);

function stampServiceWorkerBuild() {
  return {
    name: "kiranaos-service-worker-build-stamp",
    closeBundle() {
      const swPath = path.resolve(projectRoot, "dist/public/sw.js");
      if (!fs.existsSync(swPath)) return;
      const source = fs.readFileSync(swPath, "utf8");
      fs.writeFileSync(swPath, source.replaceAll("__KIRANA_BUILD_ID__", buildId));
    },
  };
}

export default defineConfig({
  base: basePath,
  define: {
    __KIRANA_BUILD_ID__: JSON.stringify(buildId),
  },
  plugins: [react(), tailwindcss(), stampServiceWorkerBuild()],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: projectRoot,
  build: {
    // KiranaOS is an installed/evergreen-browser POS; avoid shipping legacy
    // transforms that add weight without helping the supported runtime.
    target: "es2022",
    // Release builds favor smaller payloads over the default minifier's speed.
    // Two compression passes keep the full POS feature set inside the enforced
    // raw and gzip budgets without changing runtime behavior.
    minify: "terser",
    terserOptions: {
      compress: { passes: 2 },
      format: { comments: false },
    },
    outDir: path.resolve(projectRoot, "dist/public"),
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks: {
          "vendor-react": ["react", "react-dom", "wouter"],
          "vendor-data": ["dexie", "@tanstack/react-query"],
          "vendor-ui": ["lucide-react"],
          "vendor-charts": ["recharts"],
          "vendor-validation": ["zod"],
          "vendor-date": ["date-fns"],
        },
      },
    },
  },
  server: {
    port,
    strictPort: true,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
