import { useState } from "react";
import { useLocation } from "wouter";
import { CheckCircle2, LifeBuoy, Loader2, ShieldCheck, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  askAssistant,
  collectDeviceContext,
  getRecentApiRequests,
  getRecentErrors,
  submitSupportRequest,
  type AssistantAnswer,
  type SupportRequestResult,
} from "@/lib/diagnostics";

/**
 * ReportIssueButton — a floating "Report a problem" affordance available on every
 * screen (Diagnostics §7). The user types a short description; the recent API
 * calls, errors, navigation, and device context are attached automatically and
 * PII-scrubbed on the server. Positioned bottom-left on mobile (no sidebar there)
 * and bottom-right, clear of the draggable Voice Assistant, on desktop.
 */
export function ReportIssueButton() {
  const [loc] = useLocation();
  const [open, setOpen] = useState(false);
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<SupportRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [assistantAnswer, setAssistantAnswer] = useState<AssistantAnswer | null>(null);
  const [asking, setAsking] = useState(false);

  function handleOpenChange(next: boolean) {
    setOpen(next);
    if (!next) {
      // Reset after the close animation so the form doesn't flicker on the way out.
      window.setTimeout(() => {
        setDescription("");
        setSubmitting(false);
        setResult(null);
        setError(null);
        setAssistantAnswer(null);
        setAsking(false);
      }, 200);
    }
  }

  async function handleSubmit() {
    const text = description.trim();
    if (!text || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const res = await submitSupportRequest({ description: text });
      setResult(res);
    } catch (submitError) {
      setError(
        submitError instanceof Error
          ? submitError.message
          : "Could not send. Please check your connection and try again."
      );
    } finally {
      setSubmitting(false);
    }
  }

  async function handleAsk() {
    const text = description.trim();
    if (!text || asking) return;
    setAsking(true);
    setError(null);
    setAssistantAnswer(null);
    try {
      setAssistantAnswer(await askAssistant(text));
    } catch {
      setError("Couldn't reach the assistant just now — you can still send a report below.");
    } finally {
      setAsking(false);
    }
  }

  const device = open ? collectDeviceContext() : null;
  const apiCount = open ? getRecentApiRequests().length : 0;
  const errorCount = open ? getRecentErrors().length : 0;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Report a problem"
        className="fixed bottom-[max(1rem,calc(env(safe-area-inset-bottom)+92px))] left-4 z-40 flex h-11 items-center gap-2 rounded-full border border-[#dfe8f5] bg-white px-4 text-[13px] font-bold text-[#0f2147] shadow-[0_12px_28px_rgba(15,35,80,0.16)] transition-all hover:-translate-y-0.5 hover:border-primary/40 hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 print:hidden lg:bottom-6 lg:left-auto lg:right-[84px]"
      >
        <LifeBuoy size={17} aria-hidden="true" />
        <span className="hidden sm:inline">Report a problem</span>
      </button>

      <Dialog open={open} onOpenChange={handleOpenChange}>
        <DialogContent className="sm:max-w-md">
          {result ? (
            <div className="flex flex-col items-center gap-3 py-4 text-center">
              <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={24} aria-hidden="true" />
              </div>
              <DialogTitle>Report sent</DialogTitle>
              <DialogDescription>
                Thanks — our team can now see exactly what happened. Reference{" "}
                <span className="font-mono font-semibold text-foreground">{result.id.slice(0, 8)}</span>.
              </DialogDescription>
              <Button className="mt-2 min-h-11 w-full" onClick={() => handleOpenChange(false)}>
                Done
              </Button>
            </div>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Report a problem</DialogTitle>
                <DialogDescription>
                  Tell us what went wrong in a few words. We'll attach the technical details automatically so
                  you don't have to.
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-3">
                <Textarea
                  autoFocus
                  value={description}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="e.g. Bills are not syncing since this morning"
                  rows={4}
                  maxLength={2000}
                  className="resize-none"
                />

                {assistantAnswer && (
                  <div className="rounded-lg border border-primary/20 bg-primary/[0.04] p-3 text-sm">
                    <div className="mb-1 flex items-center gap-1.5 font-semibold text-primary">
                      <Wand2 size={14} aria-hidden="true" /> {assistantAnswer.topic}
                    </div>
                    <p className="whitespace-pre-line text-foreground">{assistantAnswer.answer}</p>
                    {assistantAnswer.steps.length > 0 && (
                      <ul className="mt-2 list-disc space-y-1 pl-4 text-muted-foreground">
                        {assistantAnswer.steps.map((step, index) => (
                          <li key={index}>{step}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-muted-foreground">
                      {assistantAnswer.resolved
                        ? "If this didn't solve it, send it to support below."
                        : "I've prepared a full diagnostic report — send it to support below."}
                    </p>
                  </div>
                )}

                <div className="rounded-lg border bg-muted/40 p-3 text-xs text-muted-foreground">
                  <div className="mb-1.5 flex items-center gap-1.5 font-semibold text-foreground">
                    <ShieldCheck size={13} aria-hidden="true" /> Attached automatically
                  </div>
                  <ul className="space-y-0.5">
                    <li>
                      Current screen: <span className="font-medium text-foreground">{device?.route ?? loc}</span>
                    </li>
                    <li>
                      App version: <span className="font-medium text-foreground">{device?.appVersion}</span>
                    </li>
                    <li>
                      Device:{" "}
                      <span className="font-medium text-foreground">
                        {[device?.browser, device?.os].filter(Boolean).join(" · ") || "this device"}
                      </span>
                    </li>
                    <li>
                      Connection: <span className="font-medium text-foreground">{device?.networkStatus}</span>
                    </li>
                    <li>
                      Recent activity:{" "}
                      <span className="font-medium text-foreground">
                        {apiCount} requests, {errorCount} errors
                      </span>
                    </li>
                  </ul>
                  <p className="mt-2 leading-relaxed">Personal details are removed before sending.</p>
                </div>

                {error && <p className="text-sm font-medium text-destructive">{error}</p>}
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button variant="outline" className="min-h-11" onClick={() => handleOpenChange(false)} disabled={submitting}>
                  Cancel
                </Button>
                {!assistantAnswer && (
                  <Button variant="secondary" className="min-h-11" onClick={handleAsk} disabled={asking || submitting || !description.trim()}>
                    {asking ? (
                      <>
                        <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Checking...
                      </>
                    ) : (
                      <>
                        <Wand2 size={16} aria-hidden="true" /> Get instant help
                      </>
                    )}
                  </Button>
                )}
                <Button className="min-h-11" onClick={handleSubmit} disabled={submitting || !description.trim()}>
                  {submitting ? (
                    <>
                      <Loader2 size={16} className="animate-spin" aria-hidden="true" /> Sending...
                    </>
                  ) : (
                    "Send report"
                  )}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
