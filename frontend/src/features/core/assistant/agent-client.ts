import { apiRequest } from "@/lib/api/http";

/**
 * Talking to the agent.
 *
 * The shape mirrors the backend's ordering exactly, and the important part is
 * what is missing: there is no way from here to execute a tool. A turn returns a
 * planId and sentences; confirming sends back only that id. The tool names and
 * arguments never travel through the browser, so a tampered client cannot
 * assemble a change the model never proposed and the shopkeeper never read.
 */

export type AgentRisk = "safe" | "confirm" | "owner_pin";

export interface AgentProposal {
  ref: string;
  tool: string;
  risk: AgentRisk;
  /** The sentence the shopkeeper confirms. Already localised by the backend's data. */
  summary: string;
}

export interface AgentTraceStep {
  tool: string;
  kind: "read" | "write";
  status: "ok" | "error" | "proposed";
}

export interface AgentTurn {
  planId: string | null;
  reply: string;
  plan: AgentProposal[];
  requiresConfirmation: boolean;
  requiresOwnerPin: boolean;
  trace: AgentTraceStep[];
  stoppedBecause: string;
  provider: { name: string; model: string; toolsOffered: number };
}

export interface AgentExecutionResult {
  planId: string;
  allSucceeded: boolean;
  results: Array<{ ref: string; ok: boolean; summary?: string; error?: string }>;
}

export interface AgentChatMessage {
  role: "user" | "assistant";
  content: string;
}

/**
 * One turn. History is sent back so follow-ups like "make it 3kg" resolve, and
 * the shop's UI language goes with it so the reply comes back in the language
 * the rest of the app is already speaking.
 */
export async function sendAgentMessage(
  message: string,
  history: AgentChatMessage[],
  init?: { signal?: AbortSignal; language?: "hi" | "en" },
): Promise<AgentTurn> {
  return apiRequest<AgentTurn>("/ai/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      history: history.slice(-12),
      ...(init?.language ? { language: init.language } : {}),
    }),
    signal: init?.signal,
  });
}

/**
 * Apply a plan the shopkeeper agreed to.
 *
 * Without a PIN this hits the plain route, which refuses anything price- or
 * stock-touching with OWNER_PIN_REQUIRED. With one it hits the route guarded by
 * the same requireOwnerPin middleware every other sensitive action uses, so the
 * PIN is verified server-side and never trusted from here.
 */
export async function confirmAgentPlan(planId: string, ownerPin?: string): Promise<AgentExecutionResult> {
  const path = ownerPin ? "/ai/agent/confirm-owner" : "/ai/agent/confirm";
  return apiRequest<AgentExecutionResult>(path, {
    method: "POST",
    body: JSON.stringify({ planId }),
    // apiRequest turns this into the x-owner-pin header. It must not go in the
    // body: the route validates the body strictly, and a PIN in a payload is one
    // careless log line away from being written down.
    ...(ownerPin ? { ownerPin } : {}),
  });
}

export async function rejectAgentPlan(planId: string): Promise<{ planId: string; status: string }> {
  return apiRequest<{ planId: string; status: string }>("/ai/agent/reject", {
    method: "POST",
    body: JSON.stringify({ planId }),
  });
}
