import fs from "node:fs";

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function readSchema(path) {
  return fs.readFileSync(path, "utf8");
}

function extractModel(schema, modelName) {
  const match = schema.match(new RegExp(`model\\s+${modelName}\\s+\\{[\\s\\S]*?\\n\\}`));
  assert(match, `${modelName} model must exist`);
  return match[0];
}

for (const schemaPath of ["prisma/schema.prisma", "prisma-postgres/schema.prisma"]) {
  const schema = readSchema(schemaPath);
  const shopModel = extractModel(schema, "Shop");
  const snapshotModel = extractModel(schema, "DailyClosingSnapshot");

  assert(
    /\bdailyClosingSnapshots\s+DailyClosingSnapshot\[\]/.test(shopModel),
    `${schemaPath}: Shop must expose opposite relation dailyClosingSnapshots DailyClosingSnapshot[]`
  );
  assert(
    /\bshop\s+Shop\s+@relation\(fields:\s*\[shopId\],\s*references:\s*\[id\]\)/.test(snapshotModel),
    `${schemaPath}: DailyClosingSnapshot.shop relation must stay defined`
  );
}

console.log("Phase 32 Prisma schema relation examples passed");
