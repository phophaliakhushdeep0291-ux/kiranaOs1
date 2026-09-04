import { apiRequest, ApiClientError } from "@/lib/api/http";

/**
 * The failure code, from wherever the client actually put it.
 *
 * apiRequest throws ApiClientError, which carries the server's `code` on
 * `.data`, not on the error itself. Reading `error.code` therefore always came
 * back undefined and every specific failure — no provider configured, rate
 * limited, owner PIN required — collapsed into "that did not work". The cause
 * was on screen in production and unreadable.
 */
export function agentErrorCode(error: unknown): string | undefined {
  if (error instanceof ApiClientError) return error.data?.code;
  const loose = error as { data?: { code?: string }; code?: string } | null;
  return loose?.data?.code ?? loose?.code;
}

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
  turnId: string;
  planId: string | null;
  reply: string;
  plan: AgentProposal[];
  requiresConfirmation: boolean;
  requiresOwnerPin: boolean;
  trace: AgentTraceStep[];
  stoppedBecause: string;
  provider: { name: string; model: string; toolsOffered: number };
}

/**
 * Something the till has to do itself, because it is where that state lives.
 *
 * Adding to a bill is the case: the cart is React state persisted offline so a
 * shop can bill through a power cut, so the server resolves and prices the lines
 * and the till merges them. The action has NOT happened when confirm returns.
 */
export interface AgentClientAction {
  ref: string;
  action: "add_bill_lines" | string;
  payload: {
    lines?: Array<{ productId: string; name: string; quantity: number; unit: string; rate: number }>;
    problems?: Array<{ query: string; reason: string; candidates?: string[] }>;
  };
}

export interface AgentExecutionResult {
  planId: string;
  allSucceeded: boolean;
  executionStatus: "executed" | "failed" | "uncertain";
  requiresReview: boolean;
  results: Array<{ ref: string; ok: boolean; summary?: string; error?: string; outcomeUnknown?: boolean; warning?: string }>;
  clientActions?: AgentClientAction[];
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
/** The bill on the counter, as the till reports it for context. */
export interface AgentCartLine {
  name: string;
  quantity: number;
  unit?: string;
  rate?: number;
}

export async function sendAgentMessage(
  message: string,
  history: AgentChatMessage[],
  init?: { signal?: AbortSignal; language?: "hi" | "en"; cart?: AgentCartLine[] },
): Promise<AgentTurn> {
  return apiRequest<AgentTurn>("/ai/agent/chat", {
    method: "POST",
    body: JSON.stringify({
      message,
      history: history.slice(-12),
      ...(init?.language ? { language: init.language } : {}),
      // Sent only from the till, and only as context — "make it three kilo" has
      // no referent without it. The agent never writes back through this.
      ...(init?.cart?.length ? { cart: init.cart.slice(0, 40) } : {}),
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
