import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/api/http", () => {
  class ApiClientError extends Error {
    status: number;
    data: Record<string, unknown>;

    constructor(message: string, status: number, data: Record<string, unknown> = {}) {
      super(message);
      this.status = status;
      this.data = data;
    }
  }

  return { apiRequest: vi.fn(), ApiClientError };
});

import { apiRequest, ApiClientError } from "@/lib/api/http";
import { requestAiAudioTranscription } from "@/lib/ai/ai-client";
import { backendTranscriptionErrorMessage, chooseRecorderMimeType, startBackendTranscription } from "@/features/core/voice/backend-transcription";

describe("AI audio transcription client", () => {
  beforeEach(() => vi.mocked(apiRequest).mockReset());
  afterEach(() => vi.unstubAllGlobals());

  it("uploads the recorded blob as multipart audio without overriding its boundary", async () => {
    vi.mocked(apiRequest).mockResolvedValue({
      transcript: "do kilo chini",
      model: "test-model",
      provider: "test-provider",
    });
    const audio = new Blob(["audio-bytes"], { type: "audio/webm;codecs=opus" });

    const result = await requestAiAudioTranscription(audio, { language: "ar-AE" });

    expect(result.transcript).toBe("do kilo chini");
    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [path, options] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/ai/transcribe");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toBeUndefined();
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("audio")).toBeInstanceOf(Blob);
    const uploaded = (options?.body as FormData).get("audio") as File;
    expect(uploaded.type).toBe("audio/webm");
    expect(uploaded.name).toBe("voice-command.webm");
    expect(await uploaded.text()).toBe(await audio.text());
    expect((options?.body as FormData).get("language")).toBe("ar-AE");
  });

  it("preserves MP4 recording bytes and uses an m4a filename for Safari and iOS", async () => {
    vi.mocked(apiRequest).mockResolvedValue({ transcript: "open products", model: "test", provider: "fixture" });
    const audio = new Blob([new Uint8Array([0, 255, 13, 10, 1])], { type: "audio/mp4;codecs=mp4a.40.2" });
    await requestAiAudioTranscription(audio);
    const file = (vi.mocked(apiRequest).mock.calls[0][1]?.body as FormData).get("audio") as File;
    expect(file.name).toBe("voice-command.m4a");
    expect(file.type).toBe("audio/mp4");
    expect(await file.arrayBuffer()).toEqual(await audio.arrayBuffer());
  });

  it("chooses the first recorder format supported by the browser", () => {
    expect(chooseRecorderMimeType((mime) => mime === "audio/webm")).toBe("audio/webm");
    expect(chooseRecorderMimeType(() => false)).toBe("");
  });

  it.each(["", ".", "...", "।", "  !? "])("rejects a non-speech transcript %j", async transcript => {
    vi.mocked(apiRequest).mockResolvedValue({ transcript, model: "test", provider: "fixture" });
    await expect(requestAiAudioTranscription(new Blob(["audio"]))).rejects.toThrow(/No speech was heard/);
  });
  it.each(["ओपन बिलिंग", "افتح المنتجات", "打开商品", "500"])("preserves words and digits in any script: %s", async transcript => {
    vi.mocked(apiRequest).mockResolvedValue({ transcript, model: "test", provider: "fixture" });
    expect((await requestAiAudioTranscription(new Blob(["audio"]))).transcript).toBe(transcript);
  });

  it("turns provider configuration failures into an actionable message", () => {
    const error = new ApiClientError("missing", 503, { code: "AI_KEY_MISSING" });
    expect(backendTranscriptionErrorMessage(error)).toMatch(/not configured/i);
  });

  it("records, stops tracks, transcribes, and completes the fallback lifecycle", async () => {
    const stopTrack = vi.fn();
    const onStart = vi.fn();
    const onTranscribing = vi.fn();
    const onTranscript = vi.fn();
    const onError = vi.fn();
    const onEnd = vi.fn();

    class FakeMediaRecorder {
      static isTypeSupported(mimeType: string) {
        return mimeType === "audio/webm;codecs=opus";
      }

      state: RecordingState = "inactive";
      mimeType: string;
      ondataavailable: ((event: BlobEvent) => void) | null = null;
      onerror: (() => void) | null = null;
      onstop: (() => void) | null = null;

      constructor(_stream: MediaStream, options?: MediaRecorderOptions) {
        this.mimeType = options?.mimeType ?? "audio/webm";
      }

      start() {
        this.state = "recording";
      }

      stop() {
        if (this.state === "inactive") return;
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["captured-audio"], { type: this.mimeType }) } as BlobEvent);
        queueMicrotask(() => this.onstop?.());
      }
    }

    vi.stubGlobal("window", {
      isSecureContext: true,
      location: { hostname: "localhost" },
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis),
    });
    vi.stubGlobal("navigator", {
      onLine: true,
      mediaDevices: {
        getUserMedia: vi.fn().mockResolvedValue({ getTracks: () => [{ stop: stopTrack }] }),
      },
    });
    vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
    vi.mocked(apiRequest).mockResolvedValue({ transcript: "Ramesh ko do kilo chini", model: "test", provider: "groq" });

    const session = await startBackendTranscription({ onStart, onTranscribing, onTranscript, onError, onEnd });
    expect(onStart).toHaveBeenCalledOnce();

    session.stop();
    await vi.waitFor(() => expect(onEnd).toHaveBeenCalledOnce());

    expect(stopTrack).toHaveBeenCalledOnce();
    expect(onTranscribing).toHaveBeenCalledOnce();
    expect(onTranscript).toHaveBeenCalledWith({ transcript: "Ramesh ko do kilo chini", model: "test", provider: "groq" });
    expect(onError).not.toHaveBeenCalled();
  });
  it("does not deliver a late transcript after cancellation", async () => {
    let complete!: (value: unknown) => void;
    const response = new Promise(resolve => { complete = resolve; });
    vi.mocked(apiRequest).mockReturnValue(response);
    const stopped = vi.fn();
    class Recorder {
      static isTypeSupported() { return true; }
      state = "inactive"; mimeType = "audio/webm";
      ondataavailable?: (event: { data: Blob }) => void;
      onstop?: () => void;
      start() { this.state = "recording"; }
      stop() {
        this.state = "inactive";
        this.ondataavailable?.({ data: new Blob(["test"]) });
        this.onstop?.();
      }
    }
    vi.stubGlobal("window", { isSecureContext: true, location: { hostname: "localhost" }, setTimeout, clearTimeout });
    vi.stubGlobal("navigator", { onLine: true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: stopped }] }) } });
    vi.stubGlobal("MediaRecorder", Recorder);
    const onTranscript = vi.fn(); const onError = vi.fn(); const onEnd = vi.fn();
    const session = await startBackendTranscription({ onStart: vi.fn(), onTranscribing: vi.fn(), onTranscript, onError, onEnd });
    session.stop();
    await vi.waitFor(() => expect(apiRequest).toHaveBeenCalled());
    session.cancel();
    complete({ transcript: "confirm", model: "test", provider: "fixture" });
    await response; await new Promise(resolve => setTimeout(resolve, 0));
    expect(onTranscript).not.toHaveBeenCalled();
    expect(onError).not.toHaveBeenCalled();
    expect(onEnd).toHaveBeenCalledOnce();
    expect(stopped).toHaveBeenCalled();
  });

});
