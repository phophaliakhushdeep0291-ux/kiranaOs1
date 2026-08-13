import http from "node:http";

// ─────────────────────────────────────────────────────────────
// TALLYPRIME GATEWAY
//
// TallyPrime listens on 127.0.0.1:9000 and accepts the same Import Data
// envelope it accepts from a file. The page cannot talk to it directly — a
// browser will not send a request from an HTTPS origin to a loopback port, and
// Tally answers no CORS preflight anyway — so the bridge, which is already a
// local service on the counter machine, forwards it.
//
// The target address comes from bridge configuration ONLY, never from the
// request. A bridge that posted wherever the page asked would be an open proxy
// running inside the shop's network with the shop's trust.
// ─────────────────────────────────────────────────────────────

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

export function normalizeTallyUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  let url;
  try { url = new URL(raw); } catch { throw new Error("Tally address is not a valid URL."); }
  if (url.protocol !== "http:") throw new Error("Tally's gateway speaks plain HTTP; use an http:// address.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Tally must run on this same computer.");
  return { hostname: url.hostname, port: Number(url.port || 9000), path: url.pathname || "/" };
}

/**
 * Read Tally's reply.
 *
 * Tally answers HTTP 200 whether it imported everything or nothing, and reports
 * the outcome only in the body — so treating a 200 as success would tell a
 * shopkeeper their books are up to date when Tally rejected every voucher.
 */
export function parseTallyResponse(body) {
  const number = (tag) => {
    const match = new RegExp(`<${tag}>\\s*(-?\\d+)\\s*</${tag}>`, "i").exec(body);
    return match ? Number(match[1]) : 0;
  };
  const lineErrors = [...body.matchAll(/<LINEERROR>([\s\S]*?)<\/LINEERROR>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);

  const created = number("CREATED");
  const altered = number("ALTERED");
  const ignored = number("IGNORED");
  const errors = number("ERRORS");
  const exceptions = number("EXCEPTIONS");

  // A body with no counters at all is not a Tally import reply — most often it
  // is Tally's "no company is open" page, which must not read as success.
  const recognised = /<(CREATED|ALTERED|ERRORS|EXCEPTIONS|LINEERROR|RESPONSE)>/i.test(body);

  return {
    // IGNORED means Tally skipped at least one object. The caller cannot tell
    // whether that object was a harmless master or a voucher, so it must not
    // mark the entire batch as posted and hide a missing accounting entry.
    ok: recognised && ignored === 0 && errors === 0 && exceptions === 0 && lineErrors.length === 0,
    recognised,
    created,
    altered,
    ignored,
    errors,
    exceptions,
    lineErrors: lineErrors.slice(0, 5),
  };
}

export function tallyFailureMessage(result, body) {
  if (!result.recognised) {
    const hint = /company/i.test(body) ? " Check that the right company is open in Tally." : "";
    return `Tally answered, but not with an import result.${hint}`;
  }
  if (result.lineErrors.length > 0) return `Tally rejected the import: ${result.lineErrors[0]}`.slice(0, 300);
  if (result.ignored > 0) return `Tally ignored ${result.ignored} object(s). Review Tally.imp before marking this batch as sent.`;
  return `Tally reported ${result.errors} error(s) and ${result.exceptions} exception(s) while importing.`;
}

export function postTallyEnvelope({ target, xml, timeoutMs = 120_000, request = http.request }) {
  return new Promise((resolve, reject) => {
    const payload = Buffer.from(xml, "utf8");
    const req = request(
      {
        host: target.hostname,
        port: target.port,
        path: target.path,
        method: "POST",
        headers: {
          // The envelope declares UTF-8 in its own XML prologue, and this is the
          // byte-identical document that already imports as a file, so the
          // header has to agree rather than announce a different encoding.
          "content-type": "text/xml; charset=utf-8",
          "content-length": payload.length,
        },
      },
      (res) => {
        const chunks = [];
        let size = 0;
        res.on("data", (chunk) => {
          size += chunk.length;
          // Tally's reply is a short counter block; anything huge is a page we
          // do not want to buffer.
          if (size <= 512 * 1024) chunks.push(chunk);
        });
        res.on("end", () => resolve({ status: res.statusCode || 0, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(Object.assign(new Error("Tally did not finish importing in time. It may be showing a prompt on screen."), { status: 504 }));
    });

    req.on("error", (error) => {
      // The common case by far: Tally is closed, or its gateway was never
      // switched on. Both are things the shopkeeper can fix in ten seconds if
      // we say so plainly instead of reporting a socket error.
      if (["ECONNREFUSED", "ECONNRESET", "EHOSTUNREACH", "ENOTFOUND"].includes(error?.code)) {
        return reject(Object.assign(
          new Error("Could not reach TallyPrime on this computer. Open Tally, then switch on Gateway of Tally so it can accept data."),
          { status: 503 },
        ));
      }
      reject(error);
    });

    req.end(payload);
  });
}
