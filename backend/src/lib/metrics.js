const counters = new Map();
const histograms = new Map();
const gauges = new Map();
// Metric names intentionally declared for production-check visibility.
const KNOWN_METRICS = [
  "http_requests_total",
  "http_request_duration_ms",
  "http_request_duration_seconds",
  "http_errors_total",
  "sync_push_total",
  "sync_pull_total",
  "report_export_jobs_total",
  "report_export_jobs_failed_total",
  "worker_jobs_processed_total",
  "worker_jobs_failed_total",
  "storage_errors_total",
  "reminders_requested_total",
  "reminders_sent_total",
  "reminders_failed_total",
  "reminders_skipped_total",
  "whatsapp_provider_errors_total",
  "integration_api_auth_total",
  "webhook_deliveries_total",
  "webhook_delivery_duration_ms",
  "queue_jobs_waiting",
  "queue_jobs_failed",
  "db_ready_status",
  "redis_ready_status",
  "storage_ready_status",
  "worker_ready_status",
  "worker_heartbeat_age_ms",
];

const FORBIDDEN_LABELS = new Set(["shopId", "userId", "deviceId", "customerId", "token", "phone", "mobile", "email"]);

function sanitizeMetricName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9_:]/g, "_");
}

function sanitizeLabelValue(value) {
  return String(value ?? "unknown").slice(0, 80).replace(/[\\"\n\r]/g, "_");
}

function labelKey(labels = {}) {
  const safe = {};
  for (const [key, value] of Object.entries(labels || {})) {
    if (FORBIDDEN_LABELS.has(key)) continue;
    safe[key] = sanitizeLabelValue(value);
  }
  return JSON.stringify(Object.keys(safe).sort().reduce((acc, key) => ({ ...acc, [key]: safe[key] }), {}));
}

function metricKey(name, labels = {}) {
  return `${name}|${labelKey(labels)}`;
}

export function incrementMetric(name, labels = {}, value = 1) {
  const metricName = sanitizeMetricName(name);
  const key = metricKey(metricName, labels);
  const current = counters.get(key) || { name: metricName, labels: JSON.parse(labelKey(labels)), value: 0 };
  current.value += Number(value || 1);
  counters.set(key, current);
}

export function observeMetric(name, labels = {}, value = 0) {
  const metricName = sanitizeMetricName(name);
  const key = metricKey(metricName, labels);
  const current = histograms.get(key) || { name: metricName, labels: JSON.parse(labelKey(labels)), count: 0, sum: 0, min: null, max: null };
  const numeric = Number(value || 0);
  current.count += 1;
  current.sum += numeric;
  current.min = current.min === null ? numeric : Math.min(current.min, numeric);
  current.max = current.max === null ? numeric : Math.max(current.max, numeric);
  histograms.set(key, current);
}

export function setGaugeMetric(name, labels = {}, value = 0) {
  const metricName = sanitizeMetricName(name);
  const key = metricKey(metricName, labels);
  gauges.set(key, { name: metricName, labels: JSON.parse(labelKey(labels)), value: Number(value || 0) });
}

export function recordHttpRequest({ method, routeGroup, statusCode, durationMs }) {
  const labels = { method, routeGroup, statusCode };
  incrementMetric("http_requests_total", labels);
  observeMetric("http_request_duration_ms", labels, durationMs);
  observeMetric("http_request_duration_seconds", labels, Number(durationMs || 0) / 1000);
  if (Number(statusCode) >= 500) incrementMetric("http_errors_total", labels);
}

export function recordWorkerJob({ jobName, status }) {
  const labels = { jobType: jobName, status };
  incrementMetric("worker_jobs_processed_total", labels);
  if (status === "failed") incrementMetric("worker_jobs_failed_total", { jobType: jobName });
}

export function recordQueueStatus(queueName, counts = {}) {
  setGaugeMetric("queue_jobs_waiting", { queueName }, counts.waiting || 0);
  setGaugeMetric("queue_jobs_failed", { queueName }, counts.failed || 0);
}

export function recordReadinessStatus({ database, redis, storage, storageProvider }) {
  setGaugeMetric("db_ready_status", {}, database === "ok" ? 1 : 0);
  setGaugeMetric("redis_ready_status", {}, redis === "ok" || redis === "disabled" ? 1 : 0);
  setGaugeMetric("storage_ready_status", { storageProvider: storageProvider || "unknown" }, storage === "ok" || storage === "disabled" ? 1 : 0);
}

export function recordWorkerReadinessStatus(workerHeartbeat = {}) {
  setGaugeMetric("worker_ready_status", {}, workerHeartbeat.healthy ? 1 : 0);
  const ages = Array.isArray(workerHeartbeat.workers) ? workerHeartbeat.workers.map((w) => Number(w.ageMs)).filter(Number.isFinite) : [];
  if (ages.length) setGaugeMetric("worker_heartbeat_age_ms", {}, Math.min(...ages));
}

export function recordExportJob(status) {
  incrementMetric("report_export_jobs_total", { status });
  if (status === "failed") incrementMetric("report_export_jobs_failed_total");
}

export function recordStorageError(provider, operation) {
  incrementMetric("storage_errors_total", { storageProvider: provider, operation });
}

export function recordReminderMetric({ status, provider = "disabled", channel = "whatsapp" }) {
  const labels = { provider, status, channel };
  if (status === "requested") incrementMetric("reminders_requested_total", labels);
  if (status === "sent") incrementMetric("reminders_sent_total", labels);
  if (status === "failed") incrementMetric("reminders_failed_total", labels);
  if (status === "skipped") incrementMetric("reminders_skipped_total", labels);
}

export function recordWhatsAppProviderError(provider = "disabled", status = "failed") {
  incrementMetric("whatsapp_provider_errors_total", { provider, status, channel: "whatsapp" });
}

export function recordIntegrationApiAuth(status) {
  incrementMetric("integration_api_auth_total", { status });
}

export function recordWebhookDelivery({ eventType, status, durationMs }) {
  incrementMetric("webhook_deliveries_total", { eventType, status });
  observeMetric("webhook_delivery_duration_ms", { eventType, status }, durationMs || 0);
}

export function getMetricsSnapshot() {
  return {
    success: true,
    data: {
      generatedAt: new Date().toISOString(),
      counters: Array.from(counters.values()),
      histograms: Array.from(histograms.values()).map((item) => ({
        ...item,
        avg: item.count ? item.sum / item.count : 0,
      })),
      gauges: Array.from(gauges.values()),
      knownMetrics: KNOWN_METRICS,
      note: "Labels intentionally exclude shopId/userId/deviceId/customerId to avoid high-cardinality metrics.",
    },
  };
}

function prometheusLabels(labels = {}) {
  const entries = Object.entries(labels || {});
  if (!entries.length) return "";
  return `{${entries.map(([k, v]) => `${sanitizeMetricName(k)}="${sanitizeLabelValue(v)}"`).join(",")}}`;
}

export function renderPrometheusMetrics() {
  const lines = [
    "# KiranaOS lightweight Prometheus-compatible metrics",
    "# Labels intentionally avoid shopId/userId/deviceId/customerId.",
  ];
  const allCounterNames = new Set(Array.from(counters.values()).map((m) => m.name));
  for (const name of allCounterNames) lines.push(`# TYPE ${name} counter`);
  for (const item of counters.values()) lines.push(`${item.name}${prometheusLabels(item.labels)} ${item.value}`);
  for (const item of histograms.values()) {
    const base = item.name.endsWith("_ms") ? item.name : item.name;
    lines.push(`# TYPE ${base}_summary summary`);
    lines.push(`${base}_count${prometheusLabels(item.labels)} ${item.count}`);
    lines.push(`${base}_sum${prometheusLabels(item.labels)} ${item.sum}`);
  }
  const allGaugeNames = new Set(Array.from(gauges.values()).map((m) => m.name));
  for (const name of allGaugeNames) lines.push(`# TYPE ${name} gauge`);
  for (const item of gauges.values()) lines.push(`${item.name}${prometheusLabels(item.labels)} ${item.value}`);
  return `${lines.join("\n")}\n`;
}

export const __metricsInternals = { labelKey, metricKey, FORBIDDEN_LABELS };
