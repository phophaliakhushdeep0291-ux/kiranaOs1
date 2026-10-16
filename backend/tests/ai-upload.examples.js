import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { __uploadTestUtils, uploadAiAudio, removeUploadedAudioFile } from "../src/modules/ai/ai.upload.js";
import { transcribeAudio } from "../src/modules/ai/ai.service.js";

assert.ok(__uploadTestUtils.allowedMimeTypes.has("audio/webm"), "webm audio should be accepted");
assert.ok(__uploadTestUtils.allowedMimeTypes.has("audio/wav"), "wav audio should be accepted");
assert.equal(__uploadTestUtils.getMultipartBoundary('multipart/form-data; boundary=abc123'), "abc123");
assert.equal(__uploadTestUtils.getMultipartBoundary('multipart/form-data; boundary="xyz"'), "xyz");

// Exercise real FormData serialization and the upload middleware together.
// The previous parser-only fixture missed MediaRecorder's codec parameters.
for (const [mimeType, mediaType, filename] of [
  ["audio/webm;codecs=opus", "audio/webm", "voice.webm"],
  ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "voice.m4a"],
  ["audio/ogg;codecs=opus", "audio/ogg", "voice.ogg"],
  ["text/html;charset=utf-8", null, "voice.html"],
]) {
  const bytes = Buffer.from([0x1a, 0x45, 0xdf, 0xa3, 0, 255, 13, 10]);
  const form = new FormData();
  form.append("audio", new Blob([bytes], { type: mimeType }), filename);
  form.append("language", "en");
  const wire = new Request("http://localhost/ai/transcribe", { method: "POST", body: form });
  const req = Readable.from([Buffer.from(await wire.arrayBuffer())]);
  req.headers = { "content-type": wire.headers.get("content-type") };
  let failure;
  await uploadAiAudio(req, {}, error => { failure = error; });
  try {
    if (!mediaType) {
      assert.equal(failure?.status, 415);
      assert.equal(failure?.code, "AUDIO_TYPE_UNSUPPORTED");
      assert.equal(req.aiAudioFile, undefined);
    } else {
      assert.equal(failure, undefined);
      assert.equal(req.aiAudioFile.mimetype, mediaType);
      assert.equal(req.body.language, "en");
      assert.deepEqual(await fs.promises.readFile(req.aiAudioFile.path), bytes);
    }
  } finally { await removeUploadedAudioFile(req.aiAudioFile); }
}

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
let transcriptText = "  Mohan ka bill banao shakkar 2 kilo  ";
const providerOverride = {
  provider: "test-provider",
  model: "test-transcription-model",
  client: {
    audio: {
      transcriptions: {
        async create(request) {
          transcriptionRequest = request;
          return { text: transcriptText };
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
  for (const empty of [".", "...", "।", " !? "]) {
    transcriptText = empty;
    await assert.rejects(transcribeAudio({ path: tempAudioPath }, { providerOverride }), { code: "AI_TRANSCRIPTION_EMPTY" });
  }
  for (const speech of ["ओपन बिलिंग", "افتح المنتجات", "打开商品"]) {
    transcriptText = speech;
    assert.equal((await transcribeAudio({ path: tempAudioPath }, { providerOverride })).transcript, speech);
  }
} finally {
  await fs.promises.rm(tempAudioPath, { force: true });
}

console.log("AI upload examples passed");
