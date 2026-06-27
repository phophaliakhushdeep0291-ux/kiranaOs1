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
