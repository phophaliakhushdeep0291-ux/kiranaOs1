import fs from "fs";
import os from "os";
import path from "path";

const uploadDir = path.join(os.tmpdir(), "kiranaos-ai-audio");
fs.mkdirSync(uploadDir, { recursive: true });

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

const allowedMimeTypes = new Set([
  "audio/mpeg",
  "audio/mp3",
  "audio/mp4",
  "audio/m4a",
  "audio/wav",
  "audio/webm",
  "audio/ogg",
  "audio/flac",
  "video/mp4",
  "application/octet-stream",
]);

function safeExtFromName(name, fallback = ".webm") {
  const ext = path.extname(String(name || "")).toLowerCase();
  if (!ext || ext.length > 12 || /[^a-z0-9.]/i.test(ext)) return fallback;
  return ext;
}

function makeTempPath(originalname) {
  const ext = safeExtFromName(originalname);
  return path.join(uploadDir, `ai-audio-${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`);
}

function assertAllowedMimeType(mimetype) {
  if (!mimetype || allowedMimeTypes.has(mimetype)) return;
  throw new Error(`Unsupported audio type: ${mimetype}`);
}

function parseContentDisposition(headerValue = "") {
  const result = {};
  for (const part of headerValue.split(";")) {
    const [rawKey, ...rawValueParts] = part.trim().split("=");
    const key = rawKey?.trim().toLowerCase();
    if (!key || rawValueParts.length === 0) continue;
    let value = rawValueParts.join("=").trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    result[key] = value;
  }
  return result;
}

function getMultipartBoundary(contentType = "") {
  const match = contentType.match(/boundary=(?:(?:"([^"]+)")|([^;]+))/i);
  return match?.[1] || match?.[2] || null;
}

async function readRequestBuffer(req, maxBytes = MAX_AUDIO_BYTES) {
  const chunks = [];
  let total = 0;

  for await (const chunk of req) {
    total += chunk.length;
    if (total > maxBytes) {
      throw new Error("Audio upload exceeds 25MB limit");
    }
    chunks.push(chunk);
  }

  return Buffer.concat(chunks);
}

async function writeTempAudioFile({ buffer, originalname, mimetype, fieldname }) {
  assertAllowedMimeType(mimetype);

  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw new Error("Uploaded audio file is empty");
  }
  if (buffer.length > MAX_AUDIO_BYTES) {
    throw new Error("Audio upload exceeds 25MB limit");
  }

  const filePath = makeTempPath(originalname);
  await fs.promises.writeFile(filePath, buffer);

  return {
    fieldname: fieldname ?? "audio",
    originalname: originalname ?? "audio.webm",
    encoding: "7bit",
    mimetype: mimetype ?? "application/octet-stream",
    path: filePath,
    size: buffer.length,
  };
}

function parseMultipartAudio(buffer, boundary) {
  const body = buffer.toString("latin1");
  const marker = `--${boundary}`;
  const parts = body.split(marker);

  for (const rawPart of parts) {
    if (!rawPart || rawPart === "--\r\n" || rawPart === "--") continue;

    let part = rawPart;
    if (part.startsWith("\r\n")) part = part.slice(2);
    if (part.endsWith("\r\n")) part = part.slice(0, -2);
    if (part.endsWith("--")) part = part.slice(0, -2);

    const headerEnd = part.indexOf("\r\n\r\n");
    if (headerEnd === -1) continue;

    const headerText = part.slice(0, headerEnd);
    let contentText = part.slice(headerEnd + 4);
    if (contentText.endsWith("\r\n")) contentText = contentText.slice(0, -2);

    const headers = {};
    for (const line of headerText.split("\r\n")) {
      const colonIndex = line.indexOf(":");
      if (colonIndex === -1) continue;
      const key = line.slice(0, colonIndex).trim().toLowerCase();
      const value = line.slice(colonIndex + 1).trim();
      headers[key] = value;
    }

    const disposition = parseContentDisposition(headers["content-disposition"]);
    const fieldname = disposition.name;

    if (!["audio", "file"].includes(fieldname)) continue;

    return {
      buffer: Buffer.from(contentText, "latin1"),
      originalname: disposition.filename || "audio.webm",
      mimetype: headers["content-type"] || "application/octet-stream",
      fieldname,
    };
  }

  return null;
}

function getJsonBodyAudio(req) {
  const body = req.body ?? {};
  const base64 = body.audioBase64 ?? body.fileBase64;
  if (!base64) return null;

  const cleanedBase64 = String(base64).includes(",")
    ? String(base64).split(",").pop()
    : String(base64);

  return {
    buffer: Buffer.from(cleanedBase64, "base64"),
    originalname: body.fileName ?? body.originalname ?? "audio.webm",
    mimetype: body.mimeType ?? body.mimetype ?? "audio/webm",
    fieldname: body.audioBase64 ? "audio" : "file",
  };
}

// Dependency-free upload middleware.
// Supports:
// 1. multipart/form-data with field name "audio" or "file"
// 2. raw audio/video body
// 3. JSON body with audioBase64/fileBase64 for simple frontend fallback
export async function uploadAiAudio(req, _res, next) {
  try {
    const jsonAudio = getJsonBodyAudio(req);
    if (jsonAudio) {
      req.aiAudioFile = await writeTempAudioFile(jsonAudio);
      return next();
    }

    const contentType = req.headers["content-type"] || "";

    if (contentType.startsWith("multipart/form-data")) {
      const boundary = getMultipartBoundary(contentType);
      if (!boundary) throw new Error("Multipart boundary missing");

      const buffer = await readRequestBuffer(req);
      const filePart = parseMultipartAudio(buffer, boundary);
      if (!filePart) {
        throw new Error("Audio file is required. Upload multipart/form-data field named audio or file.");
      }

      req.aiAudioFile = await writeTempAudioFile(filePart);
      return next();
    }

    if (
      contentType.startsWith("audio/") ||
      contentType.startsWith("video/") ||
      contentType === "application/octet-stream"
    ) {
      const buffer = await readRequestBuffer(req);
      req.aiAudioFile = await writeTempAudioFile({
        buffer,
        originalname: req.headers["x-file-name"] || "audio.webm",
        mimetype: contentType.split(";")[0],
        fieldname: "audio",
      });
      return next();
    }

    return next();
  } catch (err) {
    return next(err);
  }
}

export function getUploadedAudioFile(req) {
  return req.aiAudioFile ?? null;
}

export async function removeUploadedAudioFile(file) {
  if (!file?.path) return;
  try {
    await fs.promises.unlink(file.path);
  } catch {
    // Temp cleanup failure should not fail the API response.
  }
}

export const __uploadTestUtils = {
  MAX_AUDIO_BYTES,
  allowedMimeTypes,
  getMultipartBoundary,
  parseMultipartAudio,
  parseContentDisposition,
};
