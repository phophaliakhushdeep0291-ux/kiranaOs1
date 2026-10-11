import { createCounterDraft } from "@/lib/counter-draft";
import { authSessionInstance, loadAuthSession, type AuthSession } from "@/lib/storage/auth-storage";
import type { AiFeedbackOutcome } from "@/lib/ai/ai-feedback-client";
import type { AgentChatMessage, AgentTurn } from "./agent-client";

export type AssistantBubble = AgentChatMessage & {
  turn?: AgentTurn;
  feedback?: AiFeedbackOutcome | "submitting" | "failed";
};
export type AssistantPlanState =
  | { status: "idle" }
  | { status: "working" }
  | { status: "pin"; wrong: boolean }
  | { status: "done"; ok: boolean; message?: string };

export interface AssistantConversation {
  messages: AssistantBubble[];
  draft: string;
  pending: AgentTurn | null;
  planState: AssistantPlanState;
  stagedCount: number;
  updatedAt: number;
}

export const ASSISTANT_MEMORY_MAX_AGE_MS = 30 * 60_000;
export const ASSISTANT_MEMORY_MAX_MESSAGES = 40;

// In-memory only: no transcript, PIN, or executable plan is put in browser
// storage. Counter drafts already dispose their stores on logout/new login.
const conversations = createCounterDraft<AssistantConversation>(() => ({
  messages: [], draft: "", pending: null, planState: { status: "idle" }, stagedCount: 0, updatedAt: 0,
}));

export function assistantConversationScope(context: string, session: AuthSession = loadAuthSession()): string | null {
  const instance = authSessionInstance(session);
  return instance && session.user?.role ? JSON.stringify([instance, session.user.role, context]) : null;
}

export function getAssistantConversation(scope: string | null) {
  const store = conversations.forScope(scope);
  const current = store.getSnapshot().value;
  // Never interrupt an execution merely because the clock moved while it was
  // running. Its completion (or uncertainty) is written back to this store.
  if (current.planState.status !== "working" && current.updatedAt
    && (Date.now() - current.updatedAt >= ASSISTANT_MEMORY_MAX_AGE_MS || Date.now() < current.updatedAt)) store.discard();
  return store;
}

export function updateAssistantConversation(
  store: ReturnType<typeof getAssistantConversation>,
  update: (current: AssistantConversation) => AssistantConversation,
) {
  store.update(current => {
    const next = update(current);
    return {
      ...next,
      messages: next.messages.slice(-ASSISTANT_MEMORY_MAX_MESSAGES).map(message => ({ ...message, content: message.content.slice(0, 4000) })),
      draft: next.draft.slice(0, 2000),
      updatedAt: Date.now(),
    };
  });
}
