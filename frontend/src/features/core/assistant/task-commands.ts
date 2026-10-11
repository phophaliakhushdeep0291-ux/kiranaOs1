// Only a complete, unambiguous answer can approve the displayed plan. A phrase
// such as "yes but change it" must go back through clarification and a new plan.
export function planDecision(text: string): "confirm" | "cancel" | null {
  const answer = text.normalize("NFKC").toLowerCase().trim().replace(/[.!।]+$/u, "").trim();
  if (/^(confirm|yes|yes please|yes confirm|confirm it|go ahead|do it|yes do it|haan|han|haan kar do|ha kar do|kar do|हाँ|हां|हाँ कर दो|हां कर दो|कर दो|पुष्टि करो)$/u.test(answer)) return "confirm";
  if (/^(cancel|cancel it|no|no cancel|stop|don't do it|do not do it|nahi|nahin|mat karo|radd karo|नहीं|रद्द करो|मत करो)$/u.test(answer)) return "cancel";
  return null;
}

export const ASSISTANT_COMMAND_EVENT = "kirana:assistant-command";
// Cancelled means a mounted assistant accepted the handoff. If that module is
// off, the caller retains its existing local draft workflow.
export function openAssistantCommand(message: string): boolean {
  return !window.dispatchEvent(new CustomEvent(ASSISTANT_COMMAND_EVENT, { detail: { message }, cancelable: true }));
}
