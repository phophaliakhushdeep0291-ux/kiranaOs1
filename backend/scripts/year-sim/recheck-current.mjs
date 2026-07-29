import { makeClient, OWNER_PIN } from "./lib.mjs";

const requiredEnv = ["SIM_OWNER_MOBILE", "SIM_OWNER_PASSWORD", "SIM_SHOP_ID"];
for (const name of requiredEnv) {
  if (!process.env[name]) throw new Error(`${name} is required`);
}

const client = makeClient({ deviceId: "sim-fix-recheck", pin: OWNER_PIN });

function csvMetrics(csv) {
  const text = typeof csv === "string" ? csv : JSON.stringify(csv);
  const lines = text.trimEnd().split(/\r?\n/);
  return {
    bytes: Buffer.byteLength(text),
    dataRows: Math.max(0, lines.length - 1),
    header: lines[0] ?? "",
  };
}

async function waitForExport(jobId) {
  for (let attempt = 0; attempt < 120; attempt += 1) {
    const job = await client.get(`/reports/exports/${jobId}`);
    const status = job?.status ?? job?.job?.status;
    if (["completed", "failed", "cancelled"].includes(status)) return job;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for export ${jobId}`);
}

async function runExport(reportType) {
  const created = await client.post("/reports/exports", {
    reportType,
    params: { from: "2025-07-26", to: "2026-07-25" },
  });
  const jobId = created?.jobId ?? created?.id ?? created?.job?.id;
  const job = await waitForExport(jobId);
  const status = job?.status ?? job?.job?.status;
  const output = { jobId, status };
  if (status === "completed") {
    output.csv = csvMetrics(await client.get(`/reports/exports/${jobId}/download`));
  } else {
    output.error = job?.errorMessage ?? job?.job?.errorMessage ?? null;
  }
  return output;
}

const session = await client.post("/auth/login", {
  mobile: process.env.SIM_OWNER_MOBILE,
  password: process.env.SIM_OWNER_PASSWORD,
  shopId: process.env.SIM_SHOP_ID,
});
client.setToken(session.accessToken ?? session.token);

const loyaltyPage1 = await client.get("/loyalty/accounts?limit=100&offset=0");
const loyaltyPage2 = await client.get("/loyalty/accounts?limit=100&offset=100");
const page1Ids = new Set(loyaltyPage1.accounts.map((account) => account.id));

const result = {
  direct: {
    billsFinalDay: csvMetrics(
      await client.get("/reports/export/bills?from=2026-07-25&to=2026-07-25")
    ),
    stockFinalDay: csvMetrics(
      await client.get("/reports/export/stock?from=2026-07-25&to=2026-07-25")
    ),
    billsFullYear: csvMetrics(
      await client.get("/reports/export/bills?from=2025-07-26&to=2026-07-25")
    ),
    stockFullYear: csvMetrics(
      await client.get("/reports/export/stock?from=2025-07-26&to=2026-07-25")
    ),
  },
  loyalty: {
    page1Rows: loyaltyPage1.accounts.length,
    page2Rows: loyaltyPage2.accounts.length,
    total: loyaltyPage1.total,
    hasMorePage1: loyaltyPage1.hasMore,
    hasMorePage2: loyaltyPage2.hasMore,
    overlap: loyaltyPage2.accounts.filter((account) => page1Ids.has(account.id)).length,
  },
  async: {
    bills: await runExport("bills_csv"),
    stock: await runExport("stock_csv"),
  },
};

console.log(JSON.stringify(result, null, 2));
