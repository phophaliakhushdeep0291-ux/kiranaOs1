import { apiRequest } from "@/lib/api/http";

export type AiFeedbackOutcome = "correct" | "misunderstood" | "unsafe";
export type AiFeedbackReason =
  | "NONE"
  | "MISUNDERSTOOD_REQUEST"
  | "WRONG_FACT"
  | "WRONG_ITEM"
  | "WRONG_QUANTITY_OR_AMOUNT"
  | "UNSAFE_ACTION"
  | "OTHER";

const DEFAULT_REASON: Record<AiFeedbackOutcome, AiFeedbackReason> = {
  correct: "NONE",
  misunderstood: "MISUNDERSTOOD_REQUEST",
  unsafe: "UNSAFE_ACTION",
};

export function submitAiFeedback(actionLogId: string, outcome: AiFeedbackOutcome) {
  return apiRequest<{ actionLogId: string; outcome: AiFeedbackOutcome; recorded: boolean; duplicate: boolean }>("/ai/feedback", {
    method: "POST",
    body: JSON.stringify({ actionLogId, outcome, reasonCode: DEFAULT_REASON[outcome] }),
  });
}

