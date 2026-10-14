export function wholeNumber(value, name, { min = 0, max = 100000 } = {}) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
  return number;
}

export function summarize({ name, result }) {
  const completed = result.requests.total;
  // autocannon already includes timeouts in errors; counting both doubles them.
  const transportErrors = result.errors;
  const attempts = completed + transportErrors;
  const errorRate = attempts ? (transportErrors + (result.non2xx || 0)) / attempts : 1;
  // autocannon exposes p97.5, not p95. Never relabel one percentile as another.
  return {
    scenario: name, requests: completed, requestsPerSecond: result.requests.average,
    p50Ms: result.latency.p50, p97_5Ms: result.latency.p97_5, p99Ms: result.latency.p99,
    non2xx: result.non2xx || 0, transportErrors, errorRate,
  };
}

export function exceedsBudget(row, { latencyMs, errorRate }) {
  return row.requests === 0 || !Number.isFinite(row.p97_5Ms) || !Number.isFinite(row.errorRate) || row.p97_5Ms > latencyMs || row.errorRate > errorRate;
}
