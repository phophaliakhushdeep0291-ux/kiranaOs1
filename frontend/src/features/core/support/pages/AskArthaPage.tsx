import { useRef, useState } from "react";
import {
  BarChart3,
  CheckCircle2,
  Loader2,
  LifeBuoy,
  Send,
  ShieldCheck,
  Sparkles,
  Wrench,
} from "lucide-react";
import { PageHeader, PageShell } from "@/components/shared";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useAuth } from "@/features/core/auth/useAuth";
import { RemoteHelpCard } from "@/features/core/remote-support/RemoteHelpCard";
import { Textarea } from "@/components/ui/textarea";
import {
  askAssistant,
  submitSupportRequest,
  type AssistantAnswer,
} from "@/lib/diagnostics";
import { ACTIVITY_EVENTS, trackEvent } from "@/lib/activity";

/**
 * AskArthaPage — the dedicated home for the AI assistant (Diagnostics §5, §8, §9).
 *
 * The same grounded `/diagnostics/assistant` endpoint also backs the Report-Issue
 * dialog, but that one is framed around escalating a problem. This page is the
 * help centre and data assistant: ask how to do something, ask what the numbers
 * are, or describe a fault and get a diagnosis read from this shop's real logs,
 * sync state and device health. Escalation is the fallback here, not the goal.
 */

interface Turn {
  id: number;
  question: string;
  answer: AssistantAnswer | null;
  error: string | null;
}

const EXAMPLES: Array<{ icon: typeof Wrench; group: string; questions: string[] }> = [
  {
    icon: Wrench,
    group: "Something's wrong",
    questions: [
      "My printer isn't working",
      "My bills are not syncing",
      "Why is my stock negative?",
    ],
  },
  {
    icon: BarChart3,
    group: "My numbers",
    questions: [
      "Who owes me money?",
      "Show today's profit",
      "Summarize this month's sales",
    ],
  },
  {
    icon: Sparkles,
    group: "How do I…",
    questions: [
      "How do I create a GST bill?",
      "How do I restore a deleted product?",
    ],
  },
];

function confidenceTone(confidence: number) {
  if (confidence >= 0.7) return "text-emerald-600";
  if (confidence >= 0.4) return "text-amber-600";
  return "text-muted-foreground";
}

function GroundingBadge({ answer }: { answer: AssistantAnswer }) {
  const grounding = answer.aiGrounding;
  if (!grounding || grounding.status === "pending" || grounding.status === "not_requested") return null;

  if (grounding.status === "verified") {
    const count = grounding.evidenceIds.length;
    return (
      <span
        className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"
        title="The explanation was composed by KiranaOS from verified diagnostic evidence."
      >
        <ShieldCheck size={12} aria-hidden="true" />
        Evidence verified · {count} signal{count === 1 ? "" : "s"}
      </span>
    );
  }

  const providerRejected = grounding.status === "rejected" || grounding.status === "provider_error";
  return (
    <span
      className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs font-semibold text-muted-foreground"
      title={providerRejected
        ? "Unsupported AI output was rejected. This answer uses KiranaOS diagnostics only."
        : "This answer was composed directly from KiranaOS diagnostics without AI-generated facts."}
    >
      <ShieldCheck size={12} aria-hidden="true" />
      {providerRejected ? "AI output rejected · deterministic fallback" : "Deterministic diagnosis"}
    </span>
  );
}

export default function AskArthaPage() {
  const { user } = useAuth();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [asking, setAsking] = useState(false);
  const [escalatingId, setEscalatingId] = useState<number | null>(null);
  const [escalatedIds, setEscalatedIds] = useState<number[]>([]);
  const nextId = useRef(1);

  async function ask(text: string) {
    const trimmed = text.trim();
    if (!trimmed || asking) return;

    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question: trimmed, answer: null, error: null }]);
    setQuestion("");
    setAsking(true);
    const askedAt = Date.now();
    try {
      const answer = await askAssistant(trimmed);
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, answer } : t)));
      // §13 AI usage. The intent and whether the answer resolved is what the AI
      // metrics need; the question text is redacted server-side.
      trackEvent(
        ACTIVITY_EVENTS.AI_ASSISTANT_QUERY,
        { intent: answer.focus, topic: answer.topic, resolved: answer.resolved, escalated: answer.escalate },
        { durationMs: Date.now() - askedAt },
      );
      if (answer.focus === "howto") {
        trackEvent(ACTIVITY_EVENTS.HELP_ARTICLE_VIEWED, { topic: answer.topic, resolved: answer.resolved });
      }
    } catch {
      setTurns((prev) =>
        prev.map((t) =>
          t.id === id
            ? { ...t, error: "Couldn't reach the assistant. Check your connection and try again." }
            : t,
        ),
      );
    } finally {
      setAsking(false);
    }
  }

  // Escalation reuses the §7 support pipeline, so the developer receives the same
  // auto-collected bundle they would from the Report-Issue button.
  async function escalate(turn: Turn) {
    if (escalatingId !== null) return;
    setEscalatingId(turn.id);
    try {
      await submitSupportRequest({ description: turn.question });
      setEscalatedIds((prev) => [...prev, turn.id]);
    } catch {
      setTurns((prev) =>
        prev.map((t) => (t.id === turn.id ? { ...t, error: "Could not send to support just now." } : t)),
      );
    } finally {
      setEscalatingId(null);
    }
  }

  return (
    <PageShell>
      <PageHeader
        title="Ask Artha"
        description="Ask about your shop's numbers, how to do something, or what's gone wrong. Answers are read from this shop's own records — not generic advice."
      />

      {/* Granting outsiders access to the shop's data is the owner's call alone, so
          staff and managers never see the offer. The backend enforces the same rule. */}
      {user?.role === "owner" ? (
        <div className="mb-5">
          <RemoteHelpCard />
        </div>
      ) : null}

      {turns.length === 0 && (
        <div className="mb-5 grid gap-3 sm:grid-cols-3">
          {EXAMPLES.map(({ icon: Icon, group, questions }) => (
            <Card key={group}>
              <CardContent className="p-4">
                <div className="mb-2.5 flex items-center gap-2 text-sm font-semibold text-foreground">
                  <Icon size={15} aria-hidden="true" className="text-primary" />
                  {group}
                </div>
                <div className="flex flex-col gap-1.5">
                  {questions.map((q) => (
                    <button
                      key={q}
                      type="button"
                      onClick={() => ask(q)}
                      disabled={asking}
                      className="rounded-md border border-transparent bg-muted/50 px-2.5 py-1.5 text-left text-[13px] leading-snug text-muted-foreground transition-colors hover:border-primary/30 hover:bg-primary/[0.05] hover:text-foreground disabled:opacity-60"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <div className="flex flex-col gap-4">
        {turns.map((turn) => (
          <div key={turn.id} className="flex flex-col gap-2">
            <div className="self-end rounded-2xl rounded-br-sm bg-primary px-3.5 py-2 text-sm font-medium text-primary-foreground shadow-sm sm:max-w-[75%]">
              {turn.question}
            </div>

            {turn.error && (
              <p className="text-sm font-medium text-destructive">{turn.error}</p>
            )}

            {!turn.answer && !turn.error && (
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Reading your shop's diagnostics…
              </div>
            )}

            {turn.answer && (
              <Card className="sm:max-w-[85%]">
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 px-2 py-0.5 text-xs font-semibold text-primary">
                      <Sparkles size={12} aria-hidden="true" />
                      {turn.answer.topic}
                    </span>
                    <span className={`text-xs font-semibold ${confidenceTone(turn.answer.confidence)}`}>
                      {turn.answer.confidenceLabel} confidence
                    </span>
                    <GroundingBadge answer={turn.answer} />
                  </div>

                  <p className="whitespace-pre-line text-sm leading-relaxed text-foreground">
                    {turn.answer.answer}
                  </p>

                  {turn.answer.steps.length > 0 && (
                    <ol className="list-decimal space-y-1.5 pl-5 text-sm text-muted-foreground marker:font-semibold marker:text-primary">
                      {turn.answer.steps.map((step, index) => (
                        <li key={index} className="pl-0.5 leading-relaxed">{step}</li>
                      ))}
                    </ol>
                  )}

                  {turn.answer.escalate && !escalatedIds.includes(turn.id) && (
                    <div className="flex flex-wrap items-center gap-2 border-t pt-3">
                      <p className="flex-1 text-xs text-muted-foreground">
                        Not confident enough to fix this alone — a full diagnostic report is ready to send.
                      </p>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => escalate(turn)}
                        disabled={escalatingId !== null}
                      >
                        {escalatingId === turn.id ? (
                          <>
                            <Loader2 size={14} className="animate-spin" aria-hidden="true" /> Sending…
                          </>
                        ) : (
                          <>
                            <LifeBuoy size={14} aria-hidden="true" /> Send to support
                          </>
                        )}
                      </Button>
                    </div>
                  )}

                  {escalatedIds.includes(turn.id) && (
                    <p className="flex items-center gap-1.5 border-t pt-3 text-xs font-medium text-emerald-600">
                      <CheckCircle2 size={14} aria-hidden="true" />
                      Sent to support with the full diagnostic report.
                    </p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        ))}
      </div>

      <form
        className="sticky bottom-0 mt-5 flex items-end gap-2 bg-gradient-to-t from-background via-background to-transparent pb-2 pt-3"
        onSubmit={(event) => {
          event.preventDefault();
          ask(question);
        }}
      >
        <Textarea
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter sends; Shift+Enter is a newline — the convention users expect
            // from a chat box.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              ask(question);
            }
          }}
          placeholder="Ask anything about your shop…"
          rows={2}
          maxLength={2000}
          className="min-h-[52px] resize-none"
        />
        <Button type="submit" className="min-h-[52px] px-4" disabled={asking || !question.trim()}>
          {asking ? (
            <Loader2 size={17} className="animate-spin" aria-hidden="true" />
          ) : (
            <Send size={17} aria-hidden="true" />
          )}
          <span className="sr-only">Send question</span>
        </Button>
      </form>

      <p className="flex items-center justify-center gap-1.5 pb-2 text-center text-xs text-muted-foreground">
        <ShieldCheck size={12} aria-hidden="true" />
        Answers come from your own shop's data. Personal details are removed before anything is sent to support.
      </p>
    </PageShell>
  );
}
