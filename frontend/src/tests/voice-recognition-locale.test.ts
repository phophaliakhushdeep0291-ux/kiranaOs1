/**
 * Which language the mic decodes against.
 *
 * Web Speech picks ONE language model per session. A shop dictating Hindi into an
 * en-IN recogniser does not get Hindi back with a few errors — it gets English words
 * that merely sound similar, and no vocabulary in the parser can recover the sentence
 * that was spoken. The shop has already said which language it works in.
 */
import { describe, expect, it } from "vitest";
import { createOneShotRecognition, speechRecognitionLocale } from "@/features/core/voice/voice-recognition";
import type { SpeechRecognitionLike } from "@/features/core/voice/voice-types";

describe("the mic's language", () => {
  it("follows the language the shop chose", () => {
    expect(speechRecognitionLocale("hi")).toBe("hi-IN");
    expect(speechRecognitionLocale("en")).toBe("en-IN");
  });

  it("falls back to English rather than to the browser default", () => {
    expect(speechRecognitionLocale("")).toBe("en-IN");
  });

  it("is what the recogniser is actually built with", () => {
    class FakeRecognition {
      lang = "";
      continuous = false;
      interimResults = false;
      start() {}
      onstart = null;
      onresult = null;
      onerror = null;
      onend = null;
    }
    const callbacks = { onStart: () => {}, onTranscript: () => {}, onError: () => {}, onEnd: () => {} };

    const hindi = createOneShotRecognition(FakeRecognition as unknown as new () => SpeechRecognitionLike, callbacks, speechRecognitionLocale("hi"));
    expect(hindi.lang).toBe("hi-IN");

    const english = createOneShotRecognition(FakeRecognition as unknown as new () => SpeechRecognitionLike, callbacks, speechRecognitionLocale("en"));
    expect(english.lang).toBe("en-IN");
  });
});
