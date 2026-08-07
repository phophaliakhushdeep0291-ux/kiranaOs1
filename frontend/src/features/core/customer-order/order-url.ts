/**
 * Where the customer-order QR should point.
 *
 * The QR used to be built from `window.location.origin` alone — whatever the
 * till's address bar happened to hold. That is correct on the deployed domain
 * and silently wrong everywhere else: a till opened on http://localhost:5173
 * prints a QR saying "localhost", which on the customer's phone means *their*
 * phone, so Safari/Chrome just fails to connect. The shopkeeper sees a working
 * till and a customer who "can't open the link", with nothing pointing at the
 * cause.
 *
 * So: allow an explicit public base URL, and be able to tell the shopkeeper when
 * the address a customer would receive is not one their phone can reach.
 */

/** Hosts that only ever resolve to the device doing the asking. */
function isLoopbackHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]" || host.endsWith(".localhost");
}

/** RFC1918 / link-local ranges — reachable only from the same network. */
function isPrivateNetworkHost(host: string): boolean {
  if (/^10\./.test(host)) return true;
  if (/^192\.168\./.test(host)) return true;
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(host)) return true;
  if (/^169\.254\./.test(host)) return true;
  return host.endsWith(".local");
}

export type OrderUrlReach =
  | { reachable: true }
  | { reachable: false; reason: "loopback" | "private-network" | "insecure"; detail: string };

/**
 * Can a customer's phone, on mobile data, open this URL?
 * Anything loopback or RFC1918 cannot be reached at all. Plain http on a public
 * host loads but blocks the camera and trips iOS privacy features, so it is
 * called out too.
 */
export function describeOrderUrlReach(url: string): OrderUrlReach {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { reachable: false, reason: "loopback", detail: "The order link is not a valid address." };
  }
  const host = parsed.hostname.toLowerCase();
  if (isLoopbackHost(host)) {
    return {
      reachable: false,
      reason: "loopback",
      detail: `This QR points at "${host}", which on a customer's phone means their own phone — it can never open. Publish the app and set the public order address.`,
    };
  }
  if (isPrivateNetworkHost(host)) {
    return {
      reachable: false,
      reason: "private-network",
      detail: `This QR points at "${host}", a local network address. It only works for customers on the shop's own Wi-Fi, never on mobile data.`,
    };
  }
  if (parsed.protocol !== "https:") {
    return {
      reachable: false,
      reason: "insecure",
      detail: "This QR uses an insecure http:// address. Phones will warn about it and the camera scan will not work.",
    };
  }
  return { reachable: true };
}

/**
 * The address a customer-facing link hangs off.
 *
 * Prefer an explicitly configured public address so a printed QR stays correct
 * no matter which machine or port the till happens to run on. Fall back to the
 * current origin, which is right for the normal deployed case.
 *
 * Separated from the link itself because there is now more than one customer
 * link — the shop's order page, and the QR on each restaurant table — and two
 * copies of "where do we publish from?" would eventually disagree. The one that
 * was wrong would be the one already glued to a table.
 */
export function resolveCustomerOrderBase({
  configuredBaseUrl,
  currentOrigin,
  basePath = "",
}: {
  configuredBaseUrl?: string | null;
  currentOrigin: string;
  basePath?: string;
}): string {
  const configured = (configuredBaseUrl ?? "").trim().replace(/\/+$/, "");
  if (configured) return configured;
  const origin = currentOrigin.replace(/\/+$/, "");
  return `${origin}${basePath.replace(/\/+$/, "")}`;
}

export function resolveCustomerOrderUrl({
  shopId,
  configuredBaseUrl,
  currentOrigin,
  basePath = "",
}: {
  shopId: string;
  configuredBaseUrl?: string | null;
  currentOrigin: string;
  basePath?: string;
}): string {
  if (!shopId) return "";
  return `${resolveCustomerOrderBase({ configuredBaseUrl, currentOrigin, basePath })}/order/${shopId}`;
}
