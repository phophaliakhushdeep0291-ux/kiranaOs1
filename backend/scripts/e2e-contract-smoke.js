const baseUrl = process.env.CONTRACT_SMOKE_BASE_URL || process.env.SMOKE_BASE_URL || "http://localhost:3000";

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
  let body = null;
  try { body = await response.json(); } catch { body = null; }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) {
    console.error(`❌ Contract smoke failed: ${message}`);
    process.exit(1);
  }
}

console.log(`Running contract smoke checks against ${baseUrl}`);

const health = await request("/api/health");
assert(health.response.status === 200, "/api/health should return 200");
assert(health.body?.service, "/api/health should return service metadata");

const plans = await request("/api/plans");
assert([200, 404].includes(plans.response.status), "/api/plans should be public or explicitly unavailable");

const protectedWithoutToken = await request("/api/products");
assert([401, 403].includes(protectedWithoutToken.response.status), "/api/products without token should be rejected");

const webhookGet = await request("/api/payment-provider/razorpay/webhook");
assert([404, 405].includes(webhookGet.response.status), "webhook should not expose GET handler");

console.log("✅ Contract smoke checks passed");
