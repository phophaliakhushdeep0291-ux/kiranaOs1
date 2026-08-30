import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Check, Loader2, Mic, Send, ShoppingCart, Sparkles, Square, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { stageBillLines } from "@/features/core/billing/assistant-staging";
import {
  sendAgentMessage,
  confirmAgentPlan,
  rejectAgentPlan,
  type AgentChatMessage,
  agentErrorCode,
  type AgentTurn,
} from "./agent-client";
import {
  startBackendTranscription,
  backendTranscriptionErrorMessage,
  type BackendTranscriptionSession,
} from "@/features/core/voice/backend-transcription";

/**
 * The assistant panel.
 *
 * Two things about this screen are load-bearing rather than cosmetic.
 *
 * The proposal block is not a preview of something already happening — it is the
 * decision point. So it says plainly that nothing has changed, lists what would
 * change in sentences rather than JSON, and puts Cancel next to Confirm with no
 * default. A shopkeeper who taps past it without reading should still be safe,
 * which is why price and stock changes additionally demand the owner's PIN.
 *
 * The "what it read" trace is there because a number with no provenance is a
 * number you cannot act on. If it says ₹18,400 came in this week, the shopkeeper
 * can see it read the sales summary rather than guessed.
 */

type Bubble = AgentChatMessage & { turn?: AgentTurn };

type PlanState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "pin"; wrong: boolean }
  | { status: "done"; ok: boolean; message?: string };

export function AssistantPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t, language } = useAppLanguage();
  const [, navigate] = useLocation();
  const [stagedCount, setStagedCount] = useState(0);
  const [messages, setMessages] = useState<Bubble[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<AgentTurn | null>(null);
  const [planState, setPlanState] = useState<PlanState>({ status: "idle" });
  const [pin, setPin] = useState("");
  const [showTrace, setShowTrace] = useState(false);
  const [mic, setMic] = useState<"idle" | "listening" | "transcribing">("idle");
  const micSession = useRef<BackendTranscriptionSession | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, pending, planState]);

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;

    setError(null);
    setDraft("");
    setPending(null);
    setPlanState({ status: "idle" });
    setBusy(true);

    // History excludes the turn being asked, and carries only text — the plan
    // stays server-side where it cannot be edited.
    const history = messages.map(({ role, content }) => ({ role, content }));
    setMessages((current) => [...current, { role: "user", content: question }]);

    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError(t("assistant.offline"));
        return;
      }
      const turn = await sendAgentMessage(question, history, { language });
      setMessages((current) => [...current, { role: "assistant", content: turn.reply, turn }]);
      if (turn.requiresConfirmation && turn.planId) setPending(turn);
    } catch (caught) {
      const code = agentErrorCode(caught);
      setError(
        code === "AI_KEY_MISSING" ? t("assistant.unavailable")
          : code === "AI_RATE_LIMITED" ? t("assistant.busy")
            : t("assistant.failed"),
      );
    } finally {
      setBusy(false);
    }
  }, [busy, messages, t, language]);

  const applyPlan = useCallback(async (ownerPin?: string) => {
    if (!pending?.planId) return;
    setPlanState({ status: "working" });
    try {
      const result = await confirmAgentPlan(pending.planId, ownerPin);
      // Lines the server resolved are not on the bill yet — the till owns the
      // cart. Stage them and offer the trip rather than claiming it is done.
      let staged = 0;
      for (const action of result.clientActions ?? []) {
        if (action.action !== "add_bill_lines") continue;
        staged += await stageBillLines(action.payload?.lines ?? []);
      }
      setStagedCount(staged);
      setPlanState({
        status: "done",
        ok: result.allSucceeded,
        message: result.allSucceeded ? undefined : t("assistant.partialFailure"),
      });
      setPending(null);
      setPin("");
    } catch (caught) {
      const code = agentErrorCode(caught);
      if (code === "OWNER_PIN_REQUIRED") {
        setPlanState({ status: "pin", wrong: false });
        return;
      }
      // A rejected PIN comes back from the same middleware every other sensitive
      // action uses, so the message is the shared one rather than a new claim.
      if (ownerPin) {
        setPlanState({ status: "pin", wrong: true });
        return;
      }
      setPlanState({ status: "done", ok: false, message: t("assistant.failed") });
    }
  }, [pending, t]);

  const decline = useCallback(async () => {
    if (!pending?.planId) return;
    try {
      await rejectAgentPlan(pending.planId);
    } catch {
      // The plan expires unexecuted regardless; a failed decline is not worth
      // an error the shopkeeper has to dismiss.
    }
    setPending(null);
    setPlanState({ status: "done", ok: true, message: t("assistant.rejected") });
  }, [pending, t]);

  // Voice in, because the person asking "what is running out" usually has stock
  // in one hand. The transcript is sent straight away rather than parked in the
  // box: talking to it should feel like talking. That is safe here for the same
  // reason everything else is — a mis-heard word can start a lookup, but every
  // change still stops at a confirmation the shopkeeper reads.
  const toggleMic = useCallback(async () => {
    if (micSession.current) {
      micSession.current.stop();
      return;
    }
    setError(null);
    try {
      micSession.current = await startBackendTranscription({
        onStart: () => setMic("listening"),
        onTranscribing: () => setMic("transcribing"),
        onTranscript: (result) => {
          const spoken = result.transcript?.trim();
          if (spoken) void ask(spoken);
        },
        onError: (message) => setError(message),
        onEnd: () => {
          micSession.current = null;
          setMic("idle");
        },
      });
    } catch (caught) {
      micSession.current = null;
      setMic("idle");
      setError(backendTranscriptionErrorMessage(caught) || t("assistant.micDenied"));
    }
  }, [ask, t]);

  // Closing the panel mid-recording has to release the microphone, or a shared
  // shop tablet sits there with the recording indicator lit.
  useEffect(() => () => micSession.current?.cancel(), []);

  if (!open) return null;

  const examples = [
    t("assistant.example.sales"),
    t("assistant.example.lowStock"),
    t("assistant.example.udhar"),
    t("assistant.example.price"),
  ];

  const lastTrace = [...messages].reverse().find((message) => message.turn?.trace?.length)?.turn?.trace ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={t("assistant.title")}>
      <div className="flex h-full w-full flex-col rounded-none bg-white shadow-2xl sm:h-[min(680px,90vh)] sm:w-[min(440px,95vw)] sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand-softer)] text-[var(--brand)]">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-slate-900">{t("assistant.title")}</h2>
            <p className="truncate text-xs font-medium text-slate-500">{t("assistant.subtitle")}</p>
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={() => { setMessages([]); setPending(null); setPlanState({ status: "idle" }); setError(null); }}
              className="rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100"
            >
              {t("assistant.clear")}
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label={t("assistant.close")} className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </header>

        <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
          {messages.length === 0 ? (
            <div className="py-6 text-center">
              <h3 className="text-base font-black text-slate-900">{t("assistant.emptyTitle")}</h3>
              <p className="mx-auto mt-2 max-w-xs text-sm font-medium text-slate-500">{t("assistant.emptyBody")}</p>
              <div className="mt-5 grid gap-2">
                {examples.map((example) => (
                  <button
                    key={example}
                    type="button"
                    onClick={() => ask(example)}
                    className="rounded-xl border border-slate-200 px-3 py-2.5 text-left text-sm font-semibold text-slate-700 hover:border-[var(--brand)] hover:bg-slate-50"
                  >
                    {example}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <div className="grid gap-3">
            {messages.map((message, index) => (
              <div
                key={`${message.role}-${index}`}
                className={message.role === "user"
                  ? "ml-auto max-w-[85%] rounded-2xl rounded-br-sm bg-[var(--brand)] px-3.5 py-2.5 text-sm font-semibold text-white"
                  : "mr-auto max-w-[90%] whitespace-pre-wrap rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2.5 text-sm font-medium text-slate-800"}
              >
                {message.content}
              </div>
            ))}
          </div>

          {busy ? (
            <p className="mt-3 flex items-center gap-2 text-sm font-semibold text-slate-500">
              <Loader2 size={15} className="animate-spin" /> {t("assistant.thinking")}
            </p>
          ) : null}

          {error ? (
            <p className="mt-3 flex items-start gap-2 rounded-xl bg-amber-50 px-3 py-2.5 text-sm font-semibold text-amber-800">
              <AlertTriangle size={15} className="mt-0.5 shrink-0" /> {error}
            </p>
          ) : null}

          {pending ? (
            <section className="mt-4 rounded-2xl border-2 border-amber-300 bg-amber-50 p-3.5">
              <h3 className="text-sm font-black text-amber-900">{t("assistant.planTitle")}</h3>
              <p className="mt-0.5 text-xs font-bold text-amber-700">{t("assistant.planNote")}</p>
              <ul className="mt-3 grid gap-2">
                {pending.plan.map((item) => (
                  <li key={item.ref} className="flex items-start gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-amber-100 text-[11px] font-black text-amber-800">
                      {item.ref}
                    </span>
                    <span className="min-w-0 flex-1">{item.summary}</span>
                  </li>
                ))}
              </ul>

              {planState.status === "pin" ? (
                <div className="mt-3 rounded-xl bg-white p-3">
                  <h4 className="text-sm font-black text-slate-900">{t("assistant.ownerPinTitle")}</h4>
                  <p className="mt-1 text-xs font-semibold text-slate-600">{t("assistant.ownerPinBody")}</p>
                  <input
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("assistant.ownerPinPlaceholder")}
                    className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-black tracking-[0.4em]"
                  />
                  {planState.wrong ? (
                    <p className="mt-1.5 text-xs font-bold text-rose-600">{t("assistant.ownerPinWrong")}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={pin.length !== 4}
                    onClick={() => applyPlan(pin)}
                    className="mt-2 w-full rounded-lg bg-[var(--brand)] py-2.5 text-sm font-black text-white disabled:opacity-40"
                  >
                    {t("assistant.ownerPinSubmit")}
                  </button>
                </div>
              ) : (
                <div className="mt-3 flex gap-2">
                  <button
                    type="button"
                    onClick={decline}
                    disabled={planState.status === "working"}
                    className="flex-1 rounded-xl border border-slate-300 bg-white py-2.5 text-sm font-black text-slate-700 disabled:opacity-50"
                  >
                    {t("assistant.reject")}
                  </button>
                  <button
                    type="button"
                    // Always tried without a PIN first. The server decides whether
                    // this plan needs one, and answers OWNER_PIN_REQUIRED if so —
                    // the client never gets to make that call.
                    onClick={() => applyPlan()}
                    disabled={planState.status === "working"}
                    className="flex-1 rounded-xl bg-[var(--brand)] py-2.5 text-sm font-black text-white disabled:opacity-50"
                  >
                    {planState.status === "working" ? t("assistant.confirming") : t("assistant.confirm")}
                  </button>
                </div>
              )}
            </section>
          ) : null}

          {planState.status === "done" ? (
            <p className={`mt-3 flex items-center gap-2 rounded-xl px-3 py-2.5 text-sm font-bold ${planState.ok ? "bg-emerald-50 text-emerald-800" : "bg-rose-50 text-rose-800"}`}>
              <Check size={15} /> {planState.message ?? t("assistant.confirmed")}
            </p>
          ) : null}

          {stagedCount > 0 ? (
            <button
              type="button"
              onClick={() => { setStagedCount(0); onClose(); navigate("/billing"); }}
              className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl bg-[var(--brand)] py-3 text-sm font-black text-white"
            >
              <ShoppingCart size={16} /> {t("assistant.openBill", { count: stagedCount })}
            </button>
          ) : null}

          {lastTrace.length > 0 ? (
            <div className="mt-4">
              <button
                type="button"
                onClick={() => setShowTrace((current) => !current)}
                className="flex items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"
              >
                <ChevronDown size={13} className={showTrace ? "rotate-180 transition" : "transition"} />
                {showTrace ? t("assistant.sourcesHide") : t("assistant.sourcesToggle")}
              </button>
              {showTrace ? (
                <ul className="mt-2 grid gap-1 rounded-xl bg-slate-50 p-2.5">
                  {lastTrace.map((step, index) => (
                    <li key={`${step.tool}-${index}`} className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                      <span className={`h-1.5 w-1.5 rounded-full ${step.status === "ok" ? "bg-emerald-500" : step.status === "proposed" ? "bg-amber-500" : "bg-rose-500"}`} />
                      <code className="font-mono">{step.tool}</code>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
        </div>

        <form
          onSubmit={(event) => { event.preventDefault(); ask(draft); }}
          className="flex items-center gap-2 border-t border-slate-200 px-3 py-3"
        >
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy || mic === "transcribing"}
            aria-label={mic === "listening" ? t("assistant.listening") : t("assistant.speak")}
            aria-pressed={mic === "listening"}
            className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl border transition disabled:opacity-40 ${
              mic === "listening"
                ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600"
                : "border-slate-300 text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]"
            }`}
          >
            {mic === "transcribing" ? <Loader2 size={17} className="animate-spin" /> : mic === "listening" ? <Square size={15} /> : <Mic size={17} />}
          </button>
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={mic === "idle" ? t("assistant.inputPlaceholder") : mic === "listening" ? t("assistant.listening") : t("assistant.transcribing")}
            disabled={mic !== "idle"}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-[var(--brand)] disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={busy || !draft.trim()}
            aria-label={t("assistant.send")}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[var(--brand)] text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AssistantPanel;
