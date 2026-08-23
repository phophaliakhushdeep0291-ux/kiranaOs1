/**
 * How small a product photo has to be before it is allowed into a product row.
 *
 * A product image is stored as a base64 data URL in `product.imageUrl`, which
 * means the string is not just a picture — it is a database column, a row in
 * every device's IndexedDB, part of every `CREATE_PRODUCT`/`UPDATE_PRODUCT` sync
 * payload, and part of every catalogue re-download the snapshot hydration does.
 * One image is paid for many times over.
 *
 * The old pipeline capped the *file* at 2 MB and then encoded at a fixed 512px /
 * JPEG q=0.72. That caps the wrong thing: encoded size follows picture
 * complexity, not file size. Measured on this exact path, a clean packshot came
 * out at ~9 kB while a phone photo of a shelf item came out at ~158 kB — and a
 * shopkeeper uploads the second kind. Nothing bounded it.
 *
 * So the budget is on the OUTPUT. Walk down the ladder — dimension first,
 * because losing pixels hurts a thumbnail less than JPEG mush — and stop at the
 * first encoding that fits. That turns an unbounded per-product cost into a
 * known ceiling regardless of what someone photographs.
 */

/** Roughly 24 kB of data URL, so a 560-item catalogue stays near 13 MB rather than 86 MB. */
export const IMAGE_BUDGET_BYTES = 24 * 1024;

/** Dimension is stepped before quality: a smaller sharp thumbnail beats a large smeared one. */
export const IMAGE_DIMENSIONS = [512, 384, 320, 256, 192] as const;

export const IMAGE_QUALITIES = [0.72, 0.6, 0.5, 0.42] as const;

export interface EncodingStep {
  maxDimension: number;
  quality: number;
}

export function encodingLadder(): EncodingStep[] {
  const steps: EncodingStep[] = [];
  for (const maxDimension of IMAGE_DIMENSIONS) {
    for (const quality of IMAGE_QUALITIES) steps.push({ maxDimension, quality });
  }
  return steps;
}

/**
 * Fits the image inside a `max`-sided box without distorting it, and never
 * enlarges a picture that is already small — upscaling a 64px logo to 512px only
 * buys bytes. Guards against a zero dimension, which would make an unusable canvas.
 */
export function scaledSize(width: number, height: number, max: number): { width: number; height: number } {
  const longestSide = Math.max(width, height);
  if (!Number.isFinite(longestSide) || longestSide <= 0) return { width: 1, height: 1 };
  const scale = Math.min(1, max / longestSide);
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

export function withinBudget(dataUrl: string, budgetBytes = IMAGE_BUDGET_BYTES): boolean {
  return dataUrl.length <= budgetBytes;
}

/**
 * Internal diagnostic, never shown: `handleFile` catches it and renders the
 * translated `products.form.imageReadFailed` instead. Kept as a constant so the
 * hardcoded-string ratchet is not asked to carry a message no shopkeeper reads.
 */
export const IMAGE_CANVAS_UNSUPPORTED = "Canvas unsupported";

const WEBP_MIME = "image/webp";
const JPEG_MIME = "image/jpeg";
const WEBP_DATA_URL_PREFIX = "data:image/webp";

let cachedImageMimeType: string | null = null;

/**
 * WebP where the browser has it, JPEG otherwise. Measured on the same packshot,
 * WebP came out at 4.1 kB against JPEG's 9.1 kB — the cheapest saving available
 * here, for a one-line change.
 *
 * The probe checks the returned prefix rather than trusting the call, because a
 * canvas that cannot encode WebP does not throw: it quietly hands back a PNG,
 * which would be LARGER than the JPEG it replaced. Silent inflation is the one
 * way this optimisation could backfire.
 */
export function preferredImageMimeType(): string {
  if (cachedImageMimeType) return cachedImageMimeType;
  const probe = document.createElement("canvas");
  probe.width = 1;
  probe.height = 1;
  cachedImageMimeType = probe.toDataURL(WEBP_MIME).startsWith(WEBP_DATA_URL_PREFIX) ? WEBP_MIME : JPEG_MIME;
  return cachedImageMimeType;
}
