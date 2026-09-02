import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Sparkles, X } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
import {
  sendAgentMessage,
  confirmAgentPlan,
  rejectAgentPlan,
  agentErrorCode,
  type AgentCartLine,
  type AgentTurn,
} from "@/features/core/assistant/agent-client";
import type { StagedBillLine } from "../../assistant-staging";
import { submitAiFeedback, type AiFeedbackOutcome } from "@/lib/ai/ai-feedback-client";

/**
 * The assistant, inline on the till.
 *
 * It is deliberately not a second command box. The screen already has one, and
 * it runs the local parser: no network, instant, and the thing a shop depends on
 * when the line is out. That stays the fast path and is untouched.
 *
 * This appears only in the gap that path leaves — when the local parser matched
 * nothing, which today is a dead end with a red toast. A shopkeeper who said
 * something the regexes do not cover, or asked a question rather than gave a
 * command, gets an answer instead of "no product matched".
 *
 * Lines go straight into the live cart here, with no staging queue: the panel
 * elsewhere has to hand items across a route change, but on this screen the cart
 * is right there, and the parent merges them through the same code it uses for
 * a voice draft.
 */
export function BillingAssistantStrip({
  command,
  cart,
  onApplyLines,
  onDismiss,
}: {
  /** The command the local parser could not resolve. */
  command: string;
  /** The bill on the counter, for context only. */
  cart: AgentCartLine[];
  /** Merge these into the live cart. Returns how many actually landed. */
  onApplyLines: (lines: StagedBillLine[]) => number;
  onDismiss: () => void;
}) {
  const { t, language } = useAppLanguage();
  const [turn, setTurn] = useState<AgentTurn | null>(null);
  const [busy, setBusy] = useState(true);
  const [note, setNote] = useState<string | null>(null);
  const [applying, setApplying] = useState(false);
  const [feedback, setFeedback] = useState<AiFeedbackOutcome | "submitting" | "failed" | null>(null);
  // The till re-renders constantly as the cart changes; without this the same
  // command would be asked again on every keystroke elsewhere on the screen.
  const askedFor = useRef<string | null>(null);

  useEffect(() => {
    if (askedFor.current === command) return;
    askedFor.current = command;

    let cancelled = false;
    setBusy(true);
    setTurn(null);
    setNote(null);
    setFeedback(null);

    void (async () => {
      try {
        const result = await sendAgentMessage(command, [], { language, cart });
        if (!cancelled) setTurn(result);
      } catch (caught) {
        if (cancelled) return;
        const code = agentErrorCode(caught);
        setNote(
          code === "AI_KEY_MISSING" ? t("assistant.unavailable")
            : code === "AI_RATE_LIMITED" ? t("assistant.busy")
              : t("assistant.failed"),
        );
      } finally {
        if (!cancelled) setBusy(false);
      }
    })();

    return () => { cancelled = true; };
  }, [command, cart, language, t]);

  const apply = useCallback(async () => {
    if (!turn?.planId) return;
    setApplying(true);
    try {
      const result = await confirmAgentPlan(turn.planId);
      const lines = (result.clientActions ?? [])
        .filter((action) => action.action === "add_bill_lines")
        .flatMap((action) => action.payload?.lines ?? []);
      const added = onApplyLines(lines as StagedBillLine[]);
      setNote(added > 0 ? t("assistant.till.applied") : t("assistant.till.nothingToAdd"));
      setTurn(null);
    } catch (caught) {
      const code = agentErrorCode(caught);
      // A price or stock change proposed from the till still needs the owner's
      // PIN, and that dialog belongs in the full panel rather than squeezed in
      // beside a keypad — so say so and send them there.
      setNote(code === "OWNER_PIN_REQUIRED" ? t("assistant.ownerPinBody") : t("assistant.failed"));
    } finally {
      setApplying(false);
    }
  }, [turn, onApplyLines, t]);

  const dismiss = useCallback(() => {
    if (turn?.planId) void rejectAgentPlan(turn.planId).catch(() => undefined);
    onDismiss();
  }, [turn, onDismiss]);

  const labelAnswer = useCallback(async (outcome: AiFeedbackOutcome) => {
    if (!turn?.turnId) return;
    setFeedback("submitting");
    try {
      await submitAiFeedback(turn.turnId, outcome);
      setFeedback(outcome);
    } catch {
      setFeedback("failed");
    }
  }, [turn]);

  return (
    <div className="mt-2 rounded-2xl border border-[var(--brand)]/30 bg-[var(--brand-softer)] p-3 text-sm">
      <div className="flex items-start gap-2">
        <Sparkles size={16} className="mt-0.5 shrink-0 text-[var(--brand)]" />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-black uppercase tracking-wide text-[var(--brand)]">{t("assistant.till.title")}</p>
          {busy ? (
            <p className="mt-1 flex items-center gap-2 font-semibold text-slate-600">
              <Loader2 size={14} className="animate-spin" /> {t("assistant.till.thinking")}
            </p>
          ) : null}
          {turn?.reply ? <p className="mt-1 whitespace-pre-wrap font-semibold text-slate-800">{turn.reply}</p> : null}
          {note ? <p className="mt-1 font-bold text-slate-700">{note}</p> : null}

          {turn?.plan?.length ? (
            <ul className="mt-2 grid gap-1">
              {turn.plan.map((item) => (
                <li key={item.ref} className="rounded-lg bg-white px-2.5 py-1.5 text-[13px] font-semibold text-slate-800">
                  {item.summary}
                </li>
              ))}
            </ul>
          ) : null}
          {turn?.turnId ? (
            <div className="mt-2 border-t border-[var(--brand)]/15 pt-2 text-[11px]">
              {feedback && !["submitting", "failed"].includes(feedback) ? (
                <span className="font-bold text-emerald-700">{t("assistant.feedback.thanks")}</span>
              ) : (
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="font-semibold text-slate-500">{t("assistant.feedback.question")}</span>
                  {(["correct", "misunderstood", "unsafe"] as const).map((outcome) => (
                    <button
                      key={outcome}
                      type="button"
                      disabled={feedback === "submitting"}
                      onClick={() => void labelAnswer(outcome)}
                      className="min-h-8 rounded-lg border border-slate-300 bg-white px-2 font-bold text-slate-600 disabled:opacity-50"
                    >
                      {t(`assistant.feedback.${outcome}`)}
                    </button>
                  ))}
                  {feedback === "failed" ? <span className="font-bold text-rose-600">{t("assistant.feedback.failed")}</span> : null}
                </div>
              )}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={dismiss}
          aria-label={t("assistant.till.dismiss")}
          className="grid h-7 w-7 shrink-0 place-items-center rounded-lg text-slate-500 hover:bg-white"
        >
          <X size={15} />
        </button>
      </div>

      {turn?.requiresConfirmation && turn.planId ? (
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            onClick={dismiss}
            disabled={applying}
            className="flex-1 rounded-xl border border-slate-300 bg-white py-2 text-[13px] font-black text-slate-700 disabled:opacity-50"
          >
            {t("assistant.till.dismiss")}
          </button>
          <button
            type="button"
            onClick={apply}
            disabled={applying}
            className="flex-1 rounded-xl bg-[var(--brand)] py-2 text-[13px] font-black text-white disabled:opacity-50"
          >
            {applying ? <Loader2 size={14} className="mx-auto animate-spin" /> : t("assistant.till.apply")}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export default BillingAssistantStrip;
