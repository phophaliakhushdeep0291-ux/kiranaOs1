import { afterEach, describe, expect, it, vi } from "vitest";
import { monitorMicrophone } from "@/features/core/voice/microphone-monitor";

describe("microphone input feedback", () => {
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
  function fixture(amplitude: number, running = true) {
    vi.useFakeTimers();
    const disconnectSource = vi.fn(), disconnectAnalyser = vi.fn(), close = vi.fn(async () => {});
    class Context {
      state = running ? "running" : "suspended";
      resume = async () => {};
      close = close;
      createMediaStreamSource() { return { connect: vi.fn(), disconnect: disconnectSource }; }
      createAnalyser() { return { fftSize: 2048, getFloatTimeDomainData: (samples: Float32Array) => samples.fill(amplitude), disconnect: disconnectAnalyser }; }
    }
    vi.stubGlobal("AudioContext", Context);
    const onInput = vi.fn();
    const monitor = monitorMicrophone({ getAudioTracks: () => [{ label: "Built-in microphone" }] } as unknown as MediaStream, onInput);
    return { monitor, onInput, close, disconnectSource, disconnectAnalyser };
  }
  it("reports actual input levels and releases the audio graph and timer once", async () => {
    const { monitor, onInput, close, disconnectSource, disconnectAnalyser } = fixture(0.05);
    await vi.advanceTimersByTimeAsync(1000);
    expect(onInput).toHaveBeenLastCalledWith({ deviceName: "Built-in microphone", level: 25, elapsedSeconds: 1 });
    expect(monitor.isSilent()).toBe(false);
    monitor.stop(); monitor.stop();
    expect(close).toHaveBeenCalledOnce();
    expect(disconnectSource).toHaveBeenCalledOnce(); expect(disconnectAnalyser).toHaveBeenCalledOnce();
    const calls = onInput.mock.calls.length;
    await vi.advanceTimersByTimeAsync(1000);
    expect(onInput).toHaveBeenCalledTimes(calls);
  });
  it("distinguishes repeated zero samples from an unmeasured short recording", async () => {
    const { monitor } = fixture(0);
    expect(monitor.isSilent()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isSilent()).toBe(true);
    monitor.stop();
  });
  it("does not reject quiet speech", async () => {
    const { monitor } = fixture(0.0003);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isSilent()).toBe(false);
    monitor.stop();
  });
  it("does not treat a suspended audio meter as silence", async () => {
    const { monitor, onInput } = fixture(0, false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(monitor.isSilent()).toBe(false);
    expect(onInput).toHaveBeenLastCalledWith({ deviceName: "Built-in microphone", level: null, elapsedSeconds: 1 });
    monitor.stop();
  });
});
