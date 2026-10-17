import type { MicrophoneFeedback } from "./microphone-input";

/** Measure locally while recording; never play, persist or upload meter samples. */
export function monitorMicrophone(stream: MediaStream, onInput?: (input: MicrophoneFeedback) => void) {
  let context: AudioContext | undefined;
  let source: MediaStreamAudioSourceNode | undefined;
  let analyser: AnalyserNode | undefined;
  let samples: Float32Array<ArrayBuffer> | undefined;
  let readings = 0, peak = 0;
  const started = Date.now();
  const deviceName = stream.getAudioTracks?.()[0]?.label || "";
  try {
    context = new AudioContext();
    analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    samples = new Float32Array(analyser.fftSize);
    source = context.createMediaStreamSource(stream);
    source.connect(analyser);
    void context.resume().catch(() => {});
  } catch { /* Recording can still work when metering is unavailable. */ }
  const measure = () => {
    let level: number | null = null;
    if (context?.state === "running" && analyser && samples) {
      analyser.getFloatTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += sample * sample;
      const rms = Math.sqrt(sum / samples.length);
      peak = Math.max(peak, rms);
      readings++;
      level = Math.min(100, Math.round(rms * 500));
    }
    onInput?.({ deviceName, level, elapsedSeconds: Math.floor((Date.now() - started) / 1000) });
  };
  measure();
  const timer = setInterval(measure, 100);
  let stopped = false;
  return {
    // Only reject near-digital silence after enough measured samples. Quiet
    // speech and unavailable/suspended audio contexts must reach transcription.
    isSilent: () => readings >= 5 && peak < 0.0001,
    stop: () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      source?.disconnect();
      analyser?.disconnect();
      if (context && context.state !== "closed") void context.close().catch(() => {});
    },
  };
}
