/**
 * Boots the backend with Prisma's development query log suppressed.
 * A 365-day simulation issues millions of queries; logging every one of them
 * makes the run I/O-bound and the log file unusable.
 */
const originalLog = console.log;
console.log = (...args) => {
  if (typeof args[0] === "string" && args[0].startsWith("prisma:query")) return;
  originalLog(...args);
};
await import("../../src/server.js");
