import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
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

export default defineConfig({
  base: basePath,
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(projectRoot, "src"),
      "@assets": path.resolve(projectRoot, "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: projectRoot,
  build: {
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
