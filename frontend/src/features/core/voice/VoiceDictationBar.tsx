/**
 * The strip a form shows while it is being dictated into.
 *
 * Presentational only — every word arrives already translated, so the same bar
 * serves the product form and the customer form without either dictionary
 * leaking into the other.
 *
 * It deliberately sits OUTSIDE its form's scroll area. While a session is
 * running this is the only thing on screen saying what was just asked, and
 * scrolling down to check a field must not take the question away with it.
 */
import { Loader2, Mic, Square, Volume2, VolumeX } from "lucide-react";

export type VoiceDictationBarLabels = {
  start: string;
  hint: string;
  unsupported: string;
  listening: string;
  starting: string;
  heard: (text: string) => string;
  controls: string;
  stop: string;
  speakToggle: string;
};

type VoiceDictationBarProps = {
  labels: VoiceDictationBarLabels;
  supported: boolean;
  active: boolean;
  listening: boolean;
  heard: string;
  note: string;
  speakPrompts: boolean;
  /** The current question, or the closing line when nothing is left to ask. */
  prompt: string;
  onStart: () => void;
  onStop: () => void;
  onToggleSpeak: () => void;
  /** Distinguishes the two bars in tests and screenshots. */
  testId: string;
};

export function VoiceDictationBar({
  labels,
  supported,
  active,
  listening,
  heard,
  note,
  speakPrompts,
  prompt,
  onStart,
  onStop,
  onToggleSpeak,
  testId,
}: VoiceDictationBarProps) {
  if (!active) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-[#eef1f6] px-5 py-2.5">
        <button
          type="button"
          onClick={onStart}
          data-testid={`${testId}-start`}
          className="inline-flex h-9 items-center gap-1.5 rounded-lg bg-[var(--brand-softer)] px-3 text-[12px] font-black text-[var(--brand)] transition-colors hover:bg-[var(--brand-soft)] disabled:opacity-50"
          disabled={!supported}
        >
          <Mic size={14} />
          {labels.start}
        </button>
        <p className="min-w-0 flex-1 truncate text-[11px] text-[#6d7c98]">
          {supported ? labels.hint : labels.unsupported}
        </p>
      </div>
    );
  }

  return (
    <div
      className="shrink-0 border-b border-[var(--brand-border)] bg-[var(--brand-softer)] px-5 py-3"
      data-testid={`${testId}-panel`}
      aria-live="polite"
    >
      <div className="flex items-center gap-2.5">
        <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-[var(--brand)] text-white">
          {listening ? <Mic size={15} className="animate-pulse" /> : <Loader2 size={15} className="animate-spin" />}
        </span>
        <p className="min-w-0 flex-1 text-[13px] font-black leading-5 text-[var(--brand-ink)]">{prompt}</p>
        <button
          type="button"
          onClick={onToggleSpeak}
          aria-label={labels.speakToggle}
          aria-pressed={speakPrompts}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg text-[#536383] transition-colors hover:bg-white/70"
        >
          {speakPrompts ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
        <button
          type="button"
          onClick={onStop}
          data-testid={`${testId}-stop`}
          className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg bg-white px-2.5 text-[12px] font-black text-[#536383] transition-colors hover:bg-[#f1f4f8]"
        >
          <Square size={12} />
          {labels.stop}
        </button>
      </div>
      <p className="mt-1.5 text-[11px] leading-4 text-[#52627e]">
        {listening ? labels.listening : labels.starting}
        {heard ? ` · ${labels.heard(heard)}` : ""}
      </p>
      {note ? <p className="mt-0.5 text-[11px] leading-4 text-[#6d7c98]">{note}</p> : null}
      <p className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.1em] text-[#8b98ad]">{labels.controls}</p>
    </div>
  );
}
