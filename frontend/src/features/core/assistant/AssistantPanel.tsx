import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, Check, Loader2, Mic, Send, ShoppingCart, Sparkles, Square, Volume2, X } from "lucide-react";
import { useLocation } from "wouter";
import { useAppLanguage } from "@/features/core/settings/i18n";
import { executeClientActions } from "./execute-client-actions";
import type { StagedBillLine } from "@/features/core/billing/assistant-staging";
import { AssistantLanguageSelect } from "./AssistantLanguageSelect";
import { AssistantMessageText } from "./AssistantMessageText";
import { useAssistantLanguage } from "./use-assistant-language";
import { matchingSpeechVoice } from "./assistant-language";
import { planDecision } from "./task-commands";
import { useAssistantConversation, useConversationField } from "./use-assistant-conversation";
import { workflowPath } from "./workflow-handoff";
import { useAssistantCapabilities } from "./use-assistant-capabilities";
import {
  sendAgentMessage,
  confirmAgentPlan,
  rejectAgentPlan,
  supersedeAgentPlan,
  agentErrorCode,
  type AgentCartLine,
} from "./agent-client";
import {
  startBackendTranscription,
  backendTranscriptionErrorMessage,
  type BackendTranscriptionSession,
} from "@/features/core/voice/backend-transcription";
import { submitAiFeedback, type AiFeedbackOutcome } from "@/lib/ai/ai-feedback-client";

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

export function AssistantPanel({ open, onClose, initialMessage = "", cart, onApplyBillLines }: { open: boolean; onClose: () => void; initialMessage?: string; cart?: AgentCartLine[]; onApplyBillLines?: (lines: StagedBillLine[]) => number }) {
  const { t, language } = useAppLanguage();
  const [assistantLanguage, setAssistantLanguage] = useAssistantLanguage();
  const [, navigate] = useLocation();
  // Keep bill proposals separate from global proposals: returning to a till
  // must never silently retarget a global action to whichever bill is now open.
  const conversation = useAssistantConversation(onApplyBillLines ? null : "shop");
  const { isCurrent } = conversation;
  const capabilities = useAssistantCapabilities(conversation.scope);
  const [stagedCount, setStagedCount] = useConversationField(conversation, "stagedCount");
  const [messages, setMessages] = useConversationField(conversation, "messages");
  const [draft, setDraft] = useConversationField(conversation, "draft");
  const asking = useRef(false);
  const mounted = useRef(true);
  const initialSent = useRef(false);
  const request = useRef<AbortController | null>(null);
  const startingMic = useRef(false);
  const [readAloud, setReadAloud] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const speak = useCallback((text: string, replyLanguage: string = language) => {
    if (!mounted.current || !isCurrent() || !readAloud || typeof speechSynthesis === "undefined") return;
    speechSynthesis.cancel();
    const utterance = new SpeechSynthesisUtterance(text);
    const voice = matchingSpeechVoice(speechSynthesis.getVoices(), replyLanguage);
    if (!voice) { setError(t("assistant.voiceUnavailable")); return; }
    utterance.voice = voice;
    utterance.lang = voice.lang;
    speechSynthesis.speak(utterance);
  }, [readAloud, language, isCurrent, t]);
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useConversationField(conversation, "pending");
  const [planState, setPlanState] = useConversationField(conversation, "planState");
  const [pin, setPin] = useState("");
  const planRequestBusy = useRef(false);
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

  const applyPlan = useCallback(async (ownerPin?: string) => {
    if (!pending?.planId || asking.current || planRequestBusy.current || planState.status === "working" || !isCurrent()) return;
    planRequestBusy.current = true;
    setPlanState({ status: "working" });
    try {
      const result = await confirmAgentPlan(pending.planId, ownerPin);
      setPending(null);
      if (!mounted.current || !isCurrent()) throw new Error(t("assistant.outcomeUnknown"));
      // Lines the server resolved are not on the bill yet — the till owns the
      // cart. Stage them and offer the trip rather than claiming it is done.
      const { staged, applied, incompleteBill, products, suppliers, expenses, problems: unresolved } = await executeClientActions(result, ownerPin, onApplyBillLines, isCurrent);
      if (!isCurrent()) throw new Error(t("assistant.outcomeUnknown"));
      const savedNames = [...products, ...suppliers, ...expenses];
      const successes = [
        ...(savedNames.length ? [t("assistant.productSaved", { names: savedNames.join(", ") })] : []),
        ...(applied ? [t("assistant.till.applied")] : []),
        ...(staged ? [t("assistant.billStaged")] : []),
      ];
      const outcome = result.requiresReview ? t("assistant.outcomeUnknown")
        : !result.allSucceeded ? t("assistant.partialFailure")
          : incompleteBill ? t("assistant.till.reviewItems")
          : unresolved.length ? `${t("assistant.itemsUnresolved")} ${unresolved.join(", ")}`
            : successes.length ? successes.join("\n") : t("assistant.confirmed");
      setMessages(current => [...current, { role: "assistant", content: outcome }]);
      speak(outcome);
      setStagedCount(staged);
      setPlanState({
        status: "done",
        ok: result.allSucceeded && !result.requiresReview && !incompleteBill && unresolved.length === 0,
        message: outcome,
      });
      setPending(null);
      setPin("");
    } catch (caught) {
      if (!isCurrent()) return;
      const code = agentErrorCode(caught);
      if (code === "OWNER_PIN_REQUIRED") {
        setPlanState({ status: "pin", wrong: false });
        return;
      }
      // A rejected PIN comes back from the same middleware every other sensitive
      // action uses, so the message is the shared one rather than a new claim.
      if (ownerPin && (code === "OWNER_PIN_INVALID" || code === "OWNER_PIN_INVALID_FORMAT")) {
        setPlanState({ status: "pin", wrong: true });
        return;
      }
      if (code === "AI_PLAN_ALREADY_RESOLVED" || code === "AI_PLAN_TRADE_CHANGED") setPending(null);
      const outcome = t(code === "AI_PLAN_TRADE_CHANGED" ? "assistant.tradeChanged"
        : code === "OWNER_PIN_LOCKED" ? "assistant.pinLocked" : "assistant.outcomeUnknown");
      setPlanState({ status: "done", ok: false, message: outcome });
      setMessages(current => [...current, { role: "assistant", content: outcome }]);
    } finally {
      planRequestBusy.current = false;
    }
  }, [pending, planState.status, t, speak, onApplyBillLines, isCurrent, setPending, setPlanState, setMessages, setStagedCount]);

  const decline = useCallback(async () => {
    if (!pending?.planId || asking.current || planRequestBusy.current || planState.status === "working" || !isCurrent()) return;
    planRequestBusy.current = true;
    setPlanState({ status: "working" });
    try {
      const result = await rejectAgentPlan(pending.planId);
      if (!isCurrent()) return;
      if (result.status !== "rejected") {
        setPlanState({ status: "done", ok: false, message: t("assistant.outcomeUnknown") });
        setPending(null);
        return;
      }
      setPending(null);
      setPlanState({ status: "done", ok: true, message: t("assistant.rejected") });
      setMessages(current => [...current, { role: "assistant", content: t("assistant.rejected") }]);
      speak(t("assistant.rejected"));
    } catch (caught) {
      if (!isCurrent()) return;
      const resolved = agentErrorCode(caught) === "AI_PLAN_ALREADY_RESOLVED";
      if (resolved) setPending(null);
      setPlanState({ status: "done", ok: false, message: t(resolved ? "assistant.outcomeUnknown" : "assistant.cancelFailed") });
    } finally {
      planRequestBusy.current = false;
    }
  }, [pending, planState.status, t, speak, isCurrent, setPending, setPlanState, setMessages]);

  const ask = useCallback(async (text: string) => {
    const question = text.trim();
    if (!question || asking.current || planRequestBusy.current || planState.status === "working" || !isCurrent()) return;
    if (planState.status === "pin") { setError(t("assistant.pinPrivate")); return; }
    const decision = pending ? planDecision(question, pending.localization?.language ?? language) : null;
    if (decision) {
      setDraft("");
      if (decision === "confirm") await applyPlan(); else await decline();
      return;
    }
    asking.current = true;

    setError(null);
    setDraft("");
    setPlanState({ status: "idle" });
    setBusy(true);

    // History excludes the turn being asked, and carries only text — the plan
    // stays server-side where it cannot be edited.
    const history = messages.map(({ role, content, turn }) => ({ role, content: turn?.plan.length ? [content, ...turn.plan.map(item => item.summary)].join("\n") : content }));
    setMessages((current) => [...current, { role: "user", content: question }]);
    let cancellingPrevious = !!pending?.planId;

    try {
      if (typeof navigator !== "undefined" && navigator.onLine === false) {
        setError(t("assistant.offline"));
        return;
      }
      if (pending?.planId) {
        // A correction supersedes the displayed proposal; never leave an old
        // action eligible for confirmation behind a new conversation turn.
        await supersedeAgentPlan(pending.planId);
        setPending(null);
        cancellingPrevious = false;
      }
      if (!mounted.current || !isCurrent()) return;
      request.current = new AbortController();
      const turn = await sendAgentMessage(question, history, { language: assistantLanguage, cart, signal: request.current.signal });
      if (!mounted.current || !isCurrent()) return;
      setMessages((current) => [...current, { role: "assistant", content: turn.reply, turn }]);
      if (turn.requiresConfirmation && turn.planId) setPending(turn);
      speak(turn.reply, turn.localization?.language ?? language);
    } catch (caught) {
      if (!isCurrent()) return;
      const code = agentErrorCode(caught);
      if (code === "AI_PLAN_ALREADY_RESOLVED") {
        setPending(null);
        const outcome = t("assistant.outcomeUnknown");
        setPlanState({ status: "done", ok: false, message: outcome });
        setMessages(current => [...current, { role: "assistant", content: outcome }]);
        return;
      }
      if (cancellingPrevious) {
        setDraft(question);
        setError(t("assistant.cancelFailed"));
        return;
      }
      setError(
        code === "AI_TURN_TIMEOUT" ? t("assistant.timeout")
          : code === "AI_KEY_MISSING" ? t("assistant.unavailable")
          : code === "AI_RATE_LIMITED" ? t("assistant.busy")
            : t("assistant.failed"),
      );
    } finally {
      asking.current = false;
      setBusy(false);
    }
  }, [messages, pending, planState.status, applyPlan, decline, speak, t, language, assistantLanguage, cart, isCurrent, setDraft, setPlanState, setMessages, setPending]);

  useEffect(() => {
    if (initialMessage && !initialSent.current) {
      const timer = window.setTimeout(() => { initialSent.current = true; void ask(initialMessage); }, 0);
      return () => window.clearTimeout(timer);
    }
  }, [initialMessage, ask]);

  const labelAnswer = useCallback(async (actionLogId: string, outcome: AiFeedbackOutcome) => {
    setMessages((current) => current.map((message) => (
      message.turn?.turnId === actionLogId ? { ...message, feedback: "submitting" } : message
    )));
    try {
      await submitAiFeedback(actionLogId, outcome);
      setMessages((current) => current.map((message) => (
        message.turn?.turnId === actionLogId ? { ...message, feedback: outcome } : message
      )));
    } catch {
      setMessages((current) => current.map((message) => (
        message.turn?.turnId === actionLogId ? { ...message, feedback: "failed" } : message
      )));
    }
  }, [setMessages]);

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
    if (startingMic.current || asking.current || planRequestBusy.current || planState.status === "pin") return;
    startingMic.current = true;
    if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    setError(null);
    try {
      micSession.current = await startBackendTranscription({
        onStart: () => setMic("listening"),
        onTranscribing: () => setMic("transcribing"),
        onTranscript: (result) => {
          const spoken = result.transcript?.trim();
          if (spoken && mounted.current) void ask(spoken);
        },
        onError: (message) => setError(message),
        onEnd: () => {
          micSession.current = null;
          setMic("idle");
        },
      }, undefined, assistantLanguage);
      if (!mounted.current) { micSession.current.cancel(); micSession.current = null; }
    } catch (caught) {
      micSession.current = null;
      setMic("idle");
      setError(backendTranscriptionErrorMessage(caught) || t("assistant.micDenied"));
    } finally { startingMic.current = false; }
  }, [ask, t, planState.status, assistantLanguage]);

  // Closing the panel mid-recording has to release the microphone, or a shared
  // shop tablet sits there with the recording indicator lit.
  useEffect(() => {
    mounted.current = true;
    setPin("");
    setError(null);
    return () => {
      mounted.current = false;
      request.current?.abort();
      micSession.current?.cancel();
      if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel();
    };
  }, [conversation.store]);

  if (!open) return null;

  const examples = [
    t("assistant.example.tasks"),
    ...(capabilities?.assistant?.examples.length
      ? capabilities.assistant.examples.map(example => example[language]).slice(0, 3)
      : [t("assistant.example.sales"), t("assistant.example.lowStock")]),
  ];
  const title = capabilities?.assistant?.title[language] || t("assistant.title");

  const lastTrace = [...messages].reverse().find((message) => message.turn?.trace?.length)?.turn?.trace ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-end bg-black/30 p-0 sm:p-4" role="dialog" aria-modal="true" aria-label={t("assistant.title")}>
      <div className="flex h-[100dvh] w-full flex-col rounded-none bg-white shadow-2xl sm:h-[min(680px,90vh)] sm:w-[min(440px,95vw)] sm:rounded-2xl">
        <header className="flex items-center gap-3 border-b border-slate-200 px-4 py-3">
          <span className="grid h-9 w-9 place-items-center rounded-xl bg-[var(--brand-softer)] text-[var(--brand)]">
            <Sparkles size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-sm font-black text-slate-900">{title}</h2>
            <p className="truncate text-xs font-medium text-slate-500">{t("assistant.subtitle")}</p>
          </div>
          {messages.length > 0 ? (
            <button
              type="button"
              onClick={() => { setMessages([]); setDraft(""); setPending(null); setPlanState({ status: "idle" }); setError(null); }}
              disabled={busy || !!pending || mic !== "idle" || planState.status === "working"}
              className="min-h-11 rounded-lg px-2 py-1 text-xs font-bold text-slate-500 hover:bg-slate-100 disabled:opacity-50"
            >
              {t("assistant.clear")}
            </button>
          ) : null}
          <button type="button" onClick={() => { setReadAloud(value => !value); if (typeof speechSynthesis !== "undefined") speechSynthesis.cancel(); }} aria-label={t("assistant.readAloud")} aria-pressed={readAloud} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-600 hover:bg-slate-100">
            <Volume2 size={18} />
          </button>
          <button type="button" onClick={onClose} disabled={busy || mic !== "idle" || planState.status === "working"} aria-label={t("assistant.close")} className="grid h-11 w-11 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-slate-100">
            <X size={18} />
          </button>
        </header>
        <div className="border-b border-slate-200 px-4 py-2">
          <AssistantLanguageSelect value={assistantLanguage} onChange={setAssistantLanguage}
            disabled={busy || !!pending || mic !== "idle" || planState.status === "working"} />
          <p className="mt-1 text-[11px] text-slate-500">{t("assistant.languageHelp")}</p>
        </div>

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
                <div dir="auto" lang={message.turn?.localization?.language} className="whitespace-pre-wrap [overflow-wrap:anywhere]"><AssistantMessageText text={message.content} /></div>
                {message.turn?.localization?.status === "fallback" ? <p className="mt-2 text-xs text-amber-800">{t("assistant.languageFallback")}</p> : null}
                {message.turn?.localization?.originalReply ? <details className="mt-2 text-xs">
                  <summary className="cursor-pointer font-semibold">{t("assistant.originalReply")}</summary>
                  <div dir="ltr" lang="en" className="mt-1 whitespace-pre-wrap">{message.turn.localization.originalReply}</div>
                </details> : null}
                {message.turn?.handoffs?.slice(0, 3).map(handoff => workflowPath(handoff.id) ? (
                  <button key={handoff.id} type="button"
                    disabled={busy || !!pending || mic !== "idle" || planState.status === "working"}
                    onClick={() => {
                      const path = workflowPath(handoff.id);
                      if (!path || !isCurrent()) return;
                      onClose(); navigate(path);
                    }}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-left text-sm font-bold text-slate-800 disabled:opacity-50">
                    {t("assistant.openWorkflow", { name: handoff.title })}
                  </button>
                ) : null)}
                {message.role === "assistant" && message.turn?.turnId ? (
                  <div className="mt-2 border-t border-slate-200/80 pt-2 text-[11px]">
                    {message.feedback && !["submitting", "failed"].includes(message.feedback) ? (
                      <span className="font-bold text-emerald-700">{t("assistant.feedback.thanks")}</span>
                    ) : (
                      <>
                        <span className="font-semibold text-slate-500">{t("assistant.feedback.question")}</span>
                        <div className="mt-1.5 flex flex-wrap gap-1.5">
                          {(["correct", "misunderstood", "unsafe"] as const).map((outcome) => (
                            <button
                              key={outcome}
                              type="button"
                              disabled={message.feedback === "submitting"}
                              onClick={() => void labelAnswer(message.turn!.turnId, outcome)}
                              className="min-h-11 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-600 hover:border-[var(--brand)] disabled:opacity-50"
                            >
                              {t(`assistant.feedback.${outcome}`)}
                            </button>
                          ))}
                        </div>
                        {message.feedback === "failed" ? <p className="mt-1 font-bold text-rose-600">{t("assistant.feedback.failed")}</p> : null}
                      </>
                    )}
                  </div>
                ) : null}
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
              <p className="mt-1 text-xs font-semibold text-amber-800">{t("assistant.voiceConfirmHint")}</p>
              <ul className="mt-3 grid gap-2">
                {pending.plan.map((item) => (
                  <li key={item.ref} className="flex items-start gap-2 rounded-xl bg-white px-3 py-2.5 text-sm font-semibold text-slate-800">
                    <span className="mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-md bg-amber-100 text-[11px] font-black text-amber-800">
                      {item.ref}
                    </span>
                    <span dir="auto" className="min-w-0 flex-1">{item.summary}</span>
                  </li>
                ))}
              </ul>

              {planState.status === "pin" ? (
                <div className="mt-3 rounded-xl bg-white p-3">
                  <h4 className="text-sm font-black text-slate-900">{t("assistant.ownerPinTitle")}</h4>
                  <p className="mt-1 text-xs font-semibold text-slate-600">{t("assistant.ownerPinBody")}</p>
                  <p className="mt-1 text-xs text-slate-600">{t("assistant.pinPrivate")}</p>
                  <input
                    type="password"
                    aria-label={t("assistant.ownerPinTitle")}
                    value={pin}
                    onChange={(event) => setPin(event.target.value.replace(/\D/g, "").slice(0, 4))}
                    inputMode="numeric"
                    autoComplete="off"
                    placeholder={t("assistant.ownerPinPlaceholder")}
                    className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-center text-lg font-black tracking-[0.4em]"
                  />
                  <button type="button" onClick={decline} className="mt-2 min-h-11 w-full rounded-lg border border-slate-300 text-sm font-bold text-slate-700">{t("assistant.reject")}</button>
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
                    disabled={busy || mic !== "idle" || planState.status === "working"}
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
                    disabled={busy || mic !== "idle" || planState.status === "working"}
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
              {planState.ok ? <Check size={15} /> : <AlertTriangle size={15} />} {planState.message ?? t("assistant.confirmed")}
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
                className="flex min-h-11 items-center gap-1 text-xs font-bold text-slate-500 hover:text-slate-700"
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
          className="flex items-center gap-2 border-t border-slate-200 px-3 pt-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))]"
        >
          <button
            type="button"
            onClick={toggleMic}
            disabled={busy || mic === "transcribing" || planState.status === "working" || planState.status === "pin"}
            aria-label={mic === "listening" ? t("assistant.listening") : t("assistant.speak")}
            aria-pressed={mic === "listening"}
            className={`grid h-11 w-11 shrink-0 place-items-center rounded-xl border transition disabled:opacity-40 ${
              mic === "listening"
                ? "animate-pulse border-rose-300 bg-rose-50 text-rose-600"
                : "border-slate-300 text-slate-600 hover:border-[var(--brand)] hover:text-[var(--brand)]"
            }`}
          >
            {mic === "transcribing" ? <Loader2 size={17} className="animate-spin" /> : mic === "listening" ? <Square size={15} /> : <Mic size={17} />}
          </button>
          <input
            ref={inputRef}
            dir="auto"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={mic === "idle" ? t("assistant.inputPlaceholder") : mic === "listening" ? t("assistant.listening") : t("assistant.transcribing")}
            disabled={mic !== "idle" || planState.status === "pin"}
            className="min-w-0 flex-1 rounded-xl border border-slate-300 px-3.5 py-2.5 text-sm font-semibold outline-none focus:border-[var(--brand)] disabled:bg-slate-50"
          />
          <button
            type="submit"
            disabled={busy || planState.status === "working" || planState.status === "pin" || !draft.trim()}
            aria-label={t("assistant.send")}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-[var(--brand)] text-white disabled:opacity-40"
          >
            {busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}
          </button>
        </form>
      </div>
    </div>
  );
}

export default AssistantPanel;
