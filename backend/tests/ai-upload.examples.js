import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { __uploadTestUtils } from "../src/modules/ai/ai.upload.js";
import { transcribeAudio } from "../src/modules/ai/ai.service.js";

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

for (const before of [true, false]) {
  const languagePart = `--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nar-AE\r\n`;
  const audioPart = `--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="voice.webm"\r\nContent-Type: audio/webm\r\n\r\naudio-bytes\r\n\r\n`;
  const multipart = Buffer.from((before ? languagePart + audioPart : audioPart + languagePart) + `--${boundary}--\r\n`, "latin1");
  const parsed = __uploadTestUtils.parseMultipartAudio(multipart, boundary);
  assert.equal(parsed.language, "ar-AE");
  assert.equal(parsed.buffer.toString(), "audio-bytes\r\n", "multipart language must not corrupt trailing audio bytes");
}
const tempAudioPath = path.join(os.tmpdir(), `kiranaos-transcription-test-${process.pid}.webm`);
await fs.promises.writeFile(tempAudioPath, audioBytes);

let transcriptionRequest;
const providerOverride = {
  provider: "test-provider",
  model: "test-transcription-model",
  client: {
    audio: {
      transcriptions: {
        async create(request) {
          transcriptionRequest = request;
          return { text: "  Mohan ka bill banao shakkar 2 kilo  " };
        },
      },
    },
  },
};

try {
  const transcription = await transcribeAudio(
    { path: tempAudioPath, size: audioBytes.length, originalname: "voice.webm" },
    { providerOverride },
  );

  assert.deepEqual(transcription, {
    transcript: "Mohan ka bill banao shakkar 2 kilo",
    model: "test-transcription-model",
    provider: "test-provider",
  });
  assert.equal(transcriptionRequest.model, "test-transcription-model");
  assert.equal(transcriptionRequest.response_format, "json");
  assert.equal(transcriptionRequest.prompt, undefined, "automatic audio must not be biased toward Hindi/English");
  assert.equal(transcriptionRequest.language, undefined);
  await transcribeAudio({ path: tempAudioPath }, { providerOverride, language: "ar-AE" });
  assert.equal(transcriptionRequest.language, "ar", "send the provider's ISO language hint");
  await transcribeAudio({ path: tempAudioPath }, { providerOverride, language: "yue" });
  assert.equal(transcriptionRequest.language, undefined, "unsupported hint formats use provider detection");
  assert.equal(typeof transcriptionRequest.file.pipe, "function", "provider must receive a readable audio stream");
} finally {
  await fs.promises.rm(tempAudioPath, { force: true });
}

console.log("AI upload examples passed");
