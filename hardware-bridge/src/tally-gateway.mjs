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
  if (url.username || url.password || url.search || url.hash) throw new Error("Tally address cannot include credentials, a query or a fragment.");
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (!LOOPBACK_HOSTS.has(host)) throw new Error("Tally must run on this same computer.");
  return { hostname: host, port: Number(url.port || 9000), path: url.pathname || "/" };
}

/**
 * Read Tally's reply.
 *
 * Tally answers HTTP 200 whether it imported everything or nothing, and reports
 * the outcome only in the body — so treating a 200 as success would tell a
 * shopkeeper their books are up to date when Tally rejected every voucher.
 */
export function parseTallyResponse(body, { expectedCount, allowIgnored = false } = {}) {
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
  const recognised = /<(?:RESPONSE|IMPORTRESULT)(?:\s[^>]*)?>[\s\S]*<CREATED>\s*\d+\s*<\/CREATED>[\s\S]*<\/(?:RESPONSE|IMPORTRESULT)>/i.test(body)
    && !/<!DOCTYPE|<!ENTITY/i.test(body)
    && [created, altered, ignored, errors, exceptions].every((n) => Number.isSafeInteger(n) && n >= 0);
  const acknowledged = created + altered + (allowIgnored ? ignored : 0);
  const complete = expectedCount === undefined || acknowledged === expectedCount;

  return {
    // IGNORED means Tally skipped at least one object. The caller cannot tell
    // whether that object was a harmless master or a voucher, so it must not
    // mark the entire batch as posted and hide a missing accounting entry.
    ok: recognised && complete && (allowIgnored || ignored === 0) && errors === 0 && exceptions === 0 && lineErrors.length === 0,
    complete, acknowledged,
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
  if (!result.complete) return `Tally acknowledged ${result.acknowledged} objects. The transfer is incomplete; check Tally before retrying.`;
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
          if (size > 512 * 1024) { res.destroy(); reject(new Error("Tally response exceeded the allowed size")); return; }
          chunks.push(chunk);
        });
        res.on("error", reject);
        res.on("aborted", () => reject(new Error("Tally response was interrupted; check the import before retrying")));
        res.on("end", () => {
          const bytes = Buffer.concat(chunks);
          const utf16 = (bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0x3c && bytes[1] === 0);
          resolve({ status: res.statusCode || 0, body: bytes.toString(utf16 ? "utf16le" : "utf8").replace(/^\uFEFF/, "") });
        });
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
          new Error("Could not reach TallyPrime on this computer. Open Tally, then enable Server or Both in Settings → Connectivity → Client/Server Configuration."),
          { status: 503 },
        ));
      }
      reject(error);
    });

    req.end(payload);
  });
}

// Only this fixed read-only collection is used for discovery; the page cannot
// submit arbitrary TDL or choose a network destination.
export const COMPANY_REQUEST = '<ENVELOPE><HEADER><VERSION>1</VERSION><TALLYREQUEST>Export</TALLYREQUEST><TYPE>Collection</TYPE><ID>KiranaOpenCompanies</ID></HEADER><BODY><DESC><STATICVARIABLES><SVEXPORTFORMAT>$$SysName:XML</SVEXPORTFORMAT></STATICVARIABLES><TDL><TDLMESSAGE><COLLECTION NAME="KiranaOpenCompanies" ISINITIALIZE="Yes"><TYPE>Company</TYPE><NATIVEMETHOD>Name</NATIVEMETHOD><NATIVEMETHOD>GUID</NATIVEMETHOD><NATIVEMETHOD>CurrencyName</NATIVEMETHOD><NATIVEMETHOD>CountryName</NATIVEMETHOD></COLLECTION></TDLMESSAGE></TDL></DESC></BODY></ENVELOPE>';

function xmlText(value) {
  return String(value ?? "").replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, key) => {
    if (key[0] === "#") { const cp = key[1].toLowerCase() === "x" ? parseInt(key.slice(2), 16) : Number(key.slice(1)); return cp > 0 && cp <= 0x10ffff ? String.fromCodePoint(cp) : ""; }
    return { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" }[key.toLowerCase()];
  }).trim();
}
export function parseTallyCompanies(xml) {
  if (/<!DOCTYPE|<!ENTITY|<LINEERROR|<STATUS>\s*0\s*<\/STATUS>/i.test(xml) || !/<COLLECTION(?:\s[^>]*)?>/i.test(xml)) {
    throw new Error("Tally did not return its open companies. Open the required company and check connectivity settings.");
  }
  const companies = [];
  for (const match of xml.matchAll(/<COMPANY\b([^>]*)>([\s\S]*?)<\/COMPANY>/gi)) {
    const tag = (name) => xmlText(match[2].match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1]);
    const name = xmlText(match[1].match(/\bNAME="([^"]*)"/i)?.[1]) || tag("NAME");
    const guid = tag("GUID");
    const currency = tag("CURRENCYNAME");
    // Unknown currency is displayed but cannot be connected or sent to.
    const normalized = currency.toUpperCase().replace(/\s+/g, " ");
    const country = tag("COUNTRYNAME").toUpperCase();
    const currencyCode = (["INR", "₹", "INDIAN RUPEES", "INDIAN RUPEE"].includes(normalized) || (country === "INDIA" && ["RS", "RS."].includes(normalized))) ? "INR"
      : (["AED", "د.إ", "UAE DIRHAM", "UAE DIRHAMS"].includes(normalized) || (["UAE", "UNITED ARAB EMIRATES"].includes(country) && ["DHS", "DHS."].includes(normalized))) ? "AED" : null;
    if (name && /^[A-Za-z0-9-]{8,128}$/.test(guid)) companies.push({ name, guid, currency, currencyCode });
  }
  return companies;
}
export async function discoverTallyCompanies(target, options = {}) {
  const response = await postTallyEnvelope({ target, xml: COMPANY_REQUEST, timeoutMs: 10_000, ...options });
  if (response.status !== 200) throw new Error(`Tally answered with HTTP ${response.status}`);
  return parseTallyCompanies(response.body);
}
export function assertTallyDestination(xml, company, companies) {
  const actual = companies.find((row) => row.guid === company?.guid);
  if (!actual || actual.name !== company.name || !actual.currencyCode || actual.currencyCode !== company.currencyCode) {
    throw Object.assign(new Error("The selected Tally company is closed, changed or uses a different currency. Recheck the connection."), { status: 409 });
  }
  const names = [...xml.matchAll(/<SVCURRENTCOMPANY>([\s\S]*?)<\/SVCURRENTCOMPANY>/gi)];
  if (names.length !== 1 || xmlText(names[0][1]) !== actual.name) throw Object.assign(new Error("The transfer targets a different Tally company"), { status: 409 });
}
