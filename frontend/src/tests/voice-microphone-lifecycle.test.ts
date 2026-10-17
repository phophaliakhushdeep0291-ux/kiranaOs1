import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MICROPHONE_PERMISSION_TIMEOUT_MS, requestMicrophone, startBackendTranscription } from "@/features/core/voice/backend-transcription";
import { createOneShotRecognition } from "@/features/core/voice/voice-recognition";
import type { SpeechRecognitionLike } from "@/features/core/voice/voice-types";
import { abortableFetch } from "@/lib/native/abortable-fetch";

describe("microphone startup and cancellation", () => {
  beforeEach(() => vi.stubGlobal("window", { isSecureContext: true }));
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  it("requests exactly the chosen input instead of silently recording a different device", async () => {
    const stream = { getTracks: () => [] };
    const getUserMedia = vi.fn().mockResolvedValue(stream);
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
    expect(await requestMicrophone(undefined, "built-in-microphone")).toBe(stream);
    expect(getUserMedia).toHaveBeenCalledWith({ audio: { deviceId: { exact: "built-in-microphone" } } });
  });
  it("times out an ignored permission prompt and releases a late grant", async () => {
    vi.useFakeTimers();
    let grant!: (stream: MediaStream) => void;
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
    const pending = requestMicrophone();
    const rejected = expect(pending).rejects.toThrow(/permission is still waiting/);
    await vi.advanceTimersByTimeAsync(MICROPHONE_PERMISSION_TIMEOUT_MS);
    await rejected;
    const stop = vi.fn();
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it("cancels a pending permission request without retaining its late microphone", async () => {
    let grant!: (stream: MediaStream) => void;
    const stop = vi.fn();
    vi.stubGlobal("navigator", { mediaDevices: { getUserMedia: () => new Promise(resolve => { grant = resolve; }) } });
    const controller = new AbortController();
    const pending = requestMicrophone(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    grant({ getTracks: () => [{ stop }] } as unknown as MediaStream);
    await Promise.resolve();
    expect(stop).toHaveBeenCalledOnce();
  });
  it.each(["constructor", "start"])("releases the microphone after recorder %s failure and permits a retry", async failure => {
    const stop = vi.fn();
    vi.stubGlobal("navigator", { onLine: true, mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop }] }) } });
    class BrokenRecorder {
      static isTypeSupported() { return true; }
      state = "inactive";
      constructor() { if (failure === "constructor") throw new Error("recorder unavailable"); }
      start() { throw new Error("recorder unavailable"); }
    }
    vi.stubGlobal("MediaRecorder", BrokenRecorder);
    const callbacks = { onStart: vi.fn(), onTranscribing: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    await expect(startBackendTranscription(callbacks)).rejects.toThrow("recorder unavailable");
    await expect(startBackendTranscription(callbacks)).rejects.toThrow("recorder unavailable");
    expect(stop).toHaveBeenCalledTimes(2);
    expect(callbacks.onEnd).toHaveBeenCalledTimes(2);
    expect(callbacks.onStart).not.toHaveBeenCalled();
  });
  it("ends a silent Web Speech startup once, aborts it, and ignores late events", async () => {
    vi.useFakeTimers();
    const abort = vi.fn();
    class SilentRecognition {
      start() {} stop() {} abort = abort;
    }
    const callbacks = { onStart: vi.fn(), onTranscript: vi.fn(), onError: vi.fn(), onEnd: vi.fn() };
    const recognition = createOneShotRecognition(SilentRecognition as unknown as new () => SpeechRecognitionLike, callbacks);
    recognition.start();
    await vi.advanceTimersByTimeAsync(20_000);
    recognition.onstart?.(); recognition.onend?.();
    recognition.onresult?.({ results: [{ isFinal: true, 0: { transcript: "confirm" } }] });
    expect(callbacks.onError).toHaveBeenCalledOnce();
    expect(callbacks.onEnd).toHaveBeenCalledOnce();
    expect(abort).toHaveBeenCalledOnce();
    expect(callbacks.onStart).not.toHaveBeenCalled();
    expect(callbacks.onTranscript).not.toHaveBeenCalled();
  });
  it("cancels native POST fetch even when the native transport ignores AbortSignal", async () => {
    let complete!: (response: Response) => void;
    const transport = vi.fn(() => new Promise<Response>(resolve => { complete = resolve; }));
    const controller = new AbortController();
    const pending = abortableFetch(transport)("https://api.example.test/api/ai/transcribe", { method: "POST", signal: controller.signal });
    await Promise.resolve();
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    complete(new Response("late transcript"));
    await Promise.resolve();
    expect(transport).toHaveBeenCalledOnce();
  });
});
