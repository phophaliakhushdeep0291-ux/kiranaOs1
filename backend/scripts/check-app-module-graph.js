// Import the production Express graph without opening a port or touching data.
// This catches missing/renamed ESM exports across routes, services and utilities
// before a release reaches the slower runtime certification stages.
process.env.NODE_ENV ||= "test";
process.env.DATABASE_URL ||= "file:./prisma/test.db";
process.env.JWT_SECRET ||= "module-graph-check-secret-at-least-16-chars";
process.env.ALLOWED_ORIGINS ||= "http://127.0.0.1:4173";
process.env.LOG_LEVEL ||= "silent";

const appModule = await import("../src/app.js");

if (!appModule.default || typeof appModule.default.use !== "function") {
  throw new Error("src/app.js did not export an Express application");
}

console.log("Production application module graph: OK");
