import assert from "node:assert/strict";
import { __uploadTestUtils } from "../src/modules/ai/ai.upload.js";

assert.ok(__uploadTestUtils.allowedMimeTypes.has("audio/webm"), "webm audio should be accepted");
assert.ok(__uploadTestUtils.allowedMimeTypes.has("audio/wav"), "wav audio should be accepted");
assert.equal(__uploadTestUtils.getMultipartBoundary('multipart/form-data; boundary=abc123'), "abc123");
assert.equal(__uploadTestUtils.getMultipartBoundary('multipart/form-data; boundary="xyz"'), "xyz");

const boundary = "kirana-boundary";
const audioBytes = Buffer.from("fake-audio-bytes");
const multipartBody = Buffer.from([
  `--${boundary}`,
  'Content-Disposition: form-data; name="audio"; filename="voice.webm"',
  'Content-Type: audio/webm',
  '',
  audioBytes.toString("latin1"),
  `--${boundary}--`,
  '',
].join("\r\n"), "latin1");

const file = __uploadTestUtils.parseMultipartAudio(multipartBody, boundary);
assert.equal(file.fieldname, "audio");
assert.equal(file.originalname, "voice.webm");
assert.equal(file.mimetype, "audio/webm");
assert.equal(file.buffer.toString(), "fake-audio-bytes");

console.log("AI upload examples passed");
