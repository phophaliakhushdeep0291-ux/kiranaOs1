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

    const result = await requestAiAudioTranscription(audio);

    expect(result.transcript).toBe("do kilo chini");
    expect(apiRequest).toHaveBeenCalledTimes(1);
    const [path, options] = vi.mocked(apiRequest).mock.calls[0];
    expect(path).toBe("/ai/transcribe");
    expect(options?.method).toBe("POST");
    expect(options?.headers).toBeUndefined();
    expect(options?.body).toBeInstanceOf(FormData);
    expect((options?.body as FormData).get("audio")).toBeInstanceOf(Blob);
  });

  it("chooses the first recorder format supported by the browser", () => {
    expect(chooseRecorderMimeType((mime) => mime === "audio/webm")).toBe("audio/webm");
    expect(chooseRecorderMimeType(() => false)).toBe("");
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
});
