import { describe, expect, it, vi } from "vitest";
import {
  collectFinalTranscript,
  createOneShotRecognition,
  shouldAcceptFinalTranscript,
  voiceTranscriptKey,
} from "@/features/core/voice/voice-recognition";
import type { SpeechRecognitionEventLike, SpeechRecognitionLike } from "@/features/core/voice/voice-types";

function result(transcript: string, isFinal = true) {
  return { isFinal, 0: { transcript } };
}

class FakeRecognition implements SpeechRecognitionLike {
  lang = "";
  continuous = true;
  interimResults = false;
  maxAlternatives = 0;
  onstart: (() => void) | null = null;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null = null;
  onerror: SpeechRecognitionLike["onerror"] = null;
  onend: (() => void) | null = null;

  start() {
    this.onstart?.();
  }

  stop() {
    this.onend?.();
  }
}

describe("voice transcript duplicate handling", () => {
  it("ignores interim browser speech results", () => {
    const transcript = collectFinalTranscript({
      resultIndex: 0,
      results: [result("add product", false), result("add product chini", false)],
    });

    expect(transcript).toBe("");
  });

  it("does not append the same final phrase multiple times from one speech event", () => {
    const transcript = collectFinalTranscript({
      resultIndex: 0,
      results: [
        result("add product chini"),
        result("add product chini"),
        result(" add   product   chini "),
      ],
    });

    expect(transcript).toBe("add product chini");
  });

  it("debounces repeated identical final transcripts", () => {
    const last = { key: voiceTranscriptKey("add product chini"), at: 1_000 };

    expect(shouldAcceptFinalTranscript("add product chini", last, 1_500)).toBe(false);
    expect(shouldAcceptFinalTranscript("add product chini", last, 3_000)).toBe(true);
    expect(shouldAcceptFinalTranscript("add product atta", last, 1_500)).toBe(true);
  });

  it("processes saying add product chini once only once when duplicate final results repeat", () => {
    const onTranscript = vi.fn();
    const recognition = createOneShotRecognition(FakeRecognition, {
      onStart: vi.fn(),
      onTranscript,
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    recognition.onresult?.({
      resultIndex: 0,
      results: [result("add product chini"), result("add product chini")],
    });
    recognition.onresult?.({
      resultIndex: 0,
      results: [result("add product chini")],
    });

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("add product chini");
  });

  it("does not duplicate form/cart command text from repeated interim and final events", () => {
    const onTranscript = vi.fn();
    const recognition = createOneShotRecognition(FakeRecognition, {
      onStart: vi.fn(),
      onTranscript,
      onError: vi.fn(),
      onEnd: vi.fn(),
    });

    recognition.onresult?.({
      resultIndex: 0,
      results: [result("add 5 kg atta", false), result("add 5 kg atta at 38", false)],
    });
    recognition.onresult?.({
      resultIndex: 0,
      results: [result("add 5 kg atta at 38"), result("add 5 kg atta at 38")],
    });

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("add 5 kg atta at 38");
  });
});
