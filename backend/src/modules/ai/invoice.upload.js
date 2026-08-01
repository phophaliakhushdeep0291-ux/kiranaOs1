import { AppError } from "../../middleware/error.js";

const MAX_INVOICE_BYTES = 10 * 1024 * 1024;
const MIME_BY_SIGNATURE = [
  { mime: "image/png", test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) },
  { mime: "image/jpeg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { mime: "image/webp", test: (b) => b.length >= 12 && b.toString("ascii", 0, 4) === "RIFF" && b.toString("ascii", 8, 12) === "WEBP" },
];

function fail(message, statusCode, code) {
  throw new AppError(message, statusCode, code);
}

function boundaryFrom(contentType) {
  return /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType)?.slice(1).find(Boolean)?.trim() ?? null;
}

async function readBounded(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_INVOICE_BYTES + 64 * 1024) fail("Invoice image exceeds 10MB", 413, "INVOICE_IMAGE_TOO_LARGE");
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function multipartFile(body, boundary) {
  const marker = Buffer.from(`--${boundary}`);
  let cursor = 0;
  while ((cursor = body.indexOf(marker, cursor)) !== -1) {
    const headerStart = cursor + marker.length + 2;
    const headerEnd = body.indexOf(Buffer.from("\r\n\r\n"), headerStart);
    if (headerEnd === -1) break;
    const headers = body.toString("utf8", headerStart, headerEnd);
    const name = /name="([^"]+)"/i.exec(headers)?.[1];
    const dataStart = headerEnd + 4;
    const next = body.indexOf(marker, dataStart);
    if (next === -1) break;
    if (["invoice", "image", "file"].includes(name)) return body.subarray(dataStart, Math.max(dataStart, next - 2));
    cursor = next;
  }
  return null;
}

function verifiedImage(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) fail("Invoice image is required", 400, "INVOICE_IMAGE_REQUIRED");
  if (buffer.length > MAX_INVOICE_BYTES) fail("Invoice image exceeds 10MB", 413, "INVOICE_IMAGE_TOO_LARGE");
  const signature = MIME_BY_SIGNATURE.find((entry) => entry.test(buffer));
  if (!signature) fail("Use a genuine PNG, JPEG, or WebP invoice image", 415, "INVOICE_IMAGE_TYPE_UNSUPPORTED");
  return { buffer, mimeType: signature.mime, size: buffer.length };
}

export async function uploadInvoiceImage(req, _res, next) {
  try {
    const contentType = String(req.headers["content-type"] || "");
    const body = await readBounded(req);
    if (contentType.startsWith("multipart/form-data")) {
      const boundary = boundaryFrom(contentType);
      if (!boundary) fail("Multipart boundary is missing", 400, "INVOICE_MULTIPART_INVALID");
      req.invoiceImage = verifiedImage(multipartFile(body, boundary));
    } else {
      req.invoiceImage = verifiedImage(body);
    }
    next();
  } catch (error) {
    next(error);
  }
}

export const __invoiceUploadInternals = { MAX_INVOICE_BYTES, boundaryFrom, multipartFile, verifiedImage };
