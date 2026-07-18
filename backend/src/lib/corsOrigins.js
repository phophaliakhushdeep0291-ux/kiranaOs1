const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function parseAllowedOrigins(value) {
  return String(value || "")
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
}

function isLoopbackUrl(url) {
  return LOOPBACK_HOSTNAMES.has(url.hostname);
}

/**
 * Match configured origins exactly in every environment. In development only,
 * treat localhost, 127.0.0.1 and ::1 as aliases when scheme and port match.
 * This keeps the local app usable regardless of which loopback hostname Vite
 * opened while preserving the strict production allowlist.
 */
export function isAllowedCorsOrigin(origin, allowedOrigins, nodeEnv) {
  if (!origin || allowedOrigins.includes(origin)) return true;
  if (nodeEnv === "production") return false;

  try {
    const requested = new URL(origin);
    if (!isLoopbackUrl(requested)) return false;

    return allowedOrigins.some((configuredOrigin) => {
      const configured = new URL(configuredOrigin);
      return (
        isLoopbackUrl(configured) &&
        configured.protocol === requested.protocol &&
        configured.port === requested.port
      );
    });
  } catch {
    return false;
  }
}
