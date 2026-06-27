/**
 * Compact, self-contained codec for a customer's QR self-order cart.
 *
 * The customer's phone builds a cart offline and renders a QR encoding a deep link
 * (`<origin>/import-order#o=<code>`). The owner scans it with the native camera; the app
 * opens that route and decodes the cart here — no network involved. The format is therefore
 * deliberately tiny and forgiving: a 1-char version tag, the shop code, and `id:qty` pairs,
 * base64url-packed so it survives a URL fragment.
 *
 * Trust model: the decoded cart is only a *suggestion*. The owner reviews and confirms, which
 * is what actually creates the bill / touches stock — so a malformed or hostile code can do no
 * worse than produce an empty or partial draft. Decoding never throws on bad items; it skips
 * them. It only throws for a payload that isn't a valid order code at all.
 */

export const CART_CODEC_VERSION = "1";
export const IMPORT_ORDER_PATH = "/import-order";

export interface EncodedCartItem {
  productId: string;
  qty: number;
}

export interface CartPayload {
  shopCode: string;
  items: EncodedCartItem[];
}

export class CartDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CartDecodeError";
  }
}

function toBase64Url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  const bin = atob(padded);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

/** Compact a quantity: integers stay integers, fractionals keep up to 3 decimals (display units). */
function formatQty(qty: number): string {
  return String(Math.round(qty * 1000) / 1000);
}

/** Encode a cart payload into a base64url string suitable for a QR / URL fragment. */
export function encodeCart(payload: CartPayload): string {
  const itemsStr = payload.items
    .filter((it) => it.productId && Number.isFinite(it.qty) && it.qty > 0)
    .map((it) => `${it.productId}:${formatQty(it.qty)}`)
    .join(";");
  const inner = `${CART_CODEC_VERSION}|${payload.shopCode}|${itemsStr}`;
  return toBase64Url(new TextEncoder().encode(inner));
}

/**
 * Decode a base64url order code back into a cart payload. Throws {@link CartDecodeError} only
 * when the input is not a recognizable order code (bad base64, wrong/missing structure, or an
 * unsupported version). Individual malformed items are skipped rather than failing the whole code.
 */
export function decodeCart(encoded: string): CartPayload {
  let inner: string;
  try {
    inner = new TextDecoder().decode(fromBase64Url(encoded.trim()));
  } catch {
    throw new CartDecodeError("This QR code is not a valid order.");
  }

  const parts = inner.split("|");
  if (parts.length < 3) throw new CartDecodeError("This QR code is not a valid order.");

  const version = parts[0];
  const shopCode = parts[1];
  const itemsStr = parts.slice(2).join("|"); // defensive: tolerate stray separators
  if (version !== CART_CODEC_VERSION) {
    throw new CartDecodeError(`This order was made with a newer app version (${version}). Please update.`);
  }

  const items: EncodedCartItem[] = [];
  if (itemsStr) {
    for (const token of itemsStr.split(";")) {
      const idx = token.lastIndexOf(":");
      if (idx <= 0) continue;
      const productId = token.slice(0, idx);
      const qty = Number(token.slice(idx + 1));
      if (!productId || !Number.isFinite(qty) || qty <= 0) continue;
      items.push({ productId, qty });
    }
  }
  return { shopCode, items };
}

/** Build the full deep link the customer's QR should encode. */
export function buildOrderDeepLink(origin: string, payload: CartPayload): string {
  return `${origin.replace(/\/$/, "")}${IMPORT_ORDER_PATH}#o=${encodeCart(payload)}`;
}

/** Extract and decode the cart from a URL hash (e.g. `location.hash`). Returns null if absent/invalid. */
export function parseOrderFromHash(hash: string): CartPayload | null {
  const match = /[#&]o=([^&]+)/.exec(hash);
  if (!match) return null;
  try {
    return decodeCart(decodeURIComponent(match[1]));
  } catch {
    return null;
  }
}

/* ---- Multi-QR for large carts ----
 * A very large cart is split across several QRs the owner scans in turn; each carries a slice of
 * the same base64url payload, tagged with a shared group id + part index/total. The owner side
 * accumulates parts until complete, then reassembles and decodes. The encoded payload is base64url
 * (no "." or "&"), so "." is a safe field delimiter.
 *
 * Sizing for phone-to-phone scanning: a byte-mode QR's *capacity* is ~3 KB, but at that size it's
 * version 40 (177x177 modules) and unreadable on a phone screen. So we cap well below capacity to
 * keep the symbol around version ~22-25 (~100-117 modules) — comfortably scannable at the displayed
 * size — and split into more parts rather than packing one dense QR.
 */

/** Ceiling for a single QR's deep-link length before we split into multiple QRs (kept scannable). */
export const SINGLE_QR_MAX_LEN = 1200;
/** Per-part payload slice length when splitting, so each part QR also stays a scannable density. */
export const QR_CHUNK_LEN = 1000;

export type ParsedOrderHash =
  | { kind: "single"; payload: CartPayload }
  | { kind: "part"; group: string; index: number; total: number; chunk: string };

function randomGroupId(): string {
  const raw = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}${Math.random()}`;
  return raw.replace(/[^a-zA-Z0-9]/g, "").slice(0, 8) || "g";
}

/**
 * Build the QR deep link(s) for an order. Returns a single `#o=` URL when it fits in one QR, or an
 * ordered list of `#m=<group>.<i>.<n>.<chunk>` URLs to show as a multi-QR sequence.
 */
export function buildOrderQrPayloads(
  origin: string,
  payload: CartPayload,
  opts: { singleMax?: number; chunkLen?: number } = {},
): string[] {
  const singleMax = opts.singleMax ?? SINGLE_QR_MAX_LEN;
  const chunkLen = opts.chunkLen ?? QR_CHUNK_LEN;
  const base = `${origin.replace(/\/$/, "")}${IMPORT_ORDER_PATH}`;
  const encoded = encodeCart(payload);

  const singleUrl = `${base}#o=${encoded}`;
  if (singleUrl.length <= singleMax) return [singleUrl];

  const group = randomGroupId();
  const chunks: string[] = [];
  for (let i = 0; i < encoded.length; i += chunkLen) chunks.push(encoded.slice(i, i + chunkLen));
  const total = chunks.length;
  return chunks.map((chunk, i) => `${base}#m=${group}.${i + 1}.${total}.${chunk}`);
}

/** Parse a URL hash into either a complete single order or one part of a multi-QR order. */
export function parseOrderHash(hash: string): ParsedOrderHash | null {
  const single = /[#&]o=([^&]+)/.exec(hash);
  if (single) {
    try {
      return { kind: "single", payload: decodeCart(decodeURIComponent(single[1])) };
    } catch {
      return null;
    }
  }
  const multi = /[#&]m=([^&]+)/.exec(hash);
  if (multi) {
    const parts = decodeURIComponent(multi[1]).split(".");
    if (parts.length < 4) return null;
    const [group, indexStr, totalStr] = parts;
    const chunk = parts.slice(3).join("."); // defensive (chunk is base64url, so really no dots)
    const index = Number(indexStr);
    const total = Number(totalStr);
    if (!group || !chunk || !Number.isInteger(index) || !Number.isInteger(total)) return null;
    if (index < 1 || total < 1 || index > total) return null;
    return { kind: "part", group, index, total, chunk };
  }
  return null;
}

/** Reassemble collected chunks (1-based index → chunk) into a cart once all `total` are present. */
export function reassembleOrderChunks(parts: Record<number, string>, total: number): CartPayload | null {
  let encoded = "";
  for (let i = 1; i <= total; i++) {
    const chunk = parts[i];
    if (chunk == null) return null; // still missing a part
    encoded += chunk;
  }
  try {
    return decodeCart(encoded);
  } catch {
    return null;
  }
}
