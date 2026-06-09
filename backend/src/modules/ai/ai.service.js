import OpenAI from "openai";
import { env } from "../../config/env.js";
import { checkPermission } from "./ai.permissions.js";
import db from "../../db.js";

// ─────────────────────────────────────────────────────────────
// AI PROVIDER — priority order:
//   1. Groq  (GROQ_API_KEY)   — free, fast, OpenAI-compatible
//   2. OpenAI (OPENAI_API_KEY) — paid, most capable
//
// Get free Groq key: https://console.groq.com  (no credit card)
// Get free Gemini:   https://aistudio.google.com/apikey (1500/day free)
// ─────────────────────────────────────────────────────────────

let _client = null;
let _model  = null;

function getClient() {
  if (_client) return { client: _client, model: _model };

  // Priority 1: Groq — free tier, OpenAI-compatible SDK
  if (env.GROQ_API_KEY) {
    _client = new OpenAI({
      apiKey:  env.GROQ_API_KEY,
      baseURL: "https://api.groq.com/openai/v1",
    });
    _model = env.GROQ_MODEL || "llama3-8b-8192";
    console.log("[AI] Using Groq (free) —", _model);
    return { client: _client, model: _model };
  }

  // Priority 2: OpenAI — paid
  if (env.OPENAI_API_KEY) {
    _client = new OpenAI({ apiKey: env.OPENAI_API_KEY });
    _model  = env.OPENAI_MODEL || "gpt-4o-mini";
    console.log("[AI] Using OpenAI —", _model);
    return { client: _client, model: _model };
  }

  throw new Error(
    "No AI API key configured. Add GROQ_API_KEY (free) to .env. " +
    "Get one at https://console.groq.com — no credit card needed."
  );
}

// ─────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// Teaches GPT the KiranaOS command schema and Indian shopkeeper language
// ─────────────────────────────────────────────────────────────
const SYSTEM_PROMPT = `
You are the voice command parser for KiranaOS, a shop management app used by Indian kirana shopkeepers.
You understand Hindi, Hinglish, and English mixed speech.

Your ONLY job is to parse the shopkeeper's spoken transcript into a structured JSON command.
You must NEVER modify any database. You must NEVER write code. You ONLY return JSON.

OUTPUT FORMAT (always return valid JSON, nothing else):
{
  "intent": "<INTENT>",
  "confidence": <0.0-1.0>,
  "customer": { "name": "<name or null>", "mobile": "<10-digit or null>" } | null,
  "items": [{ "query": "<product name>", "quantity": <number>, "unit": "<unit>" }] | null,
  "payment": { "cash": <number or null>, "upi": <number or null>, "remaining": "udhar|null" } | null,
  "target": "<bill number or product name or customer name if relevant>" | null,
  "discount": <number or null>,
  "needsConfirmation": <true|false>,
  "clarificationNeeded": <true|false>,
  "clarificationQuestion": "<ask user this if unclear>" | null,
  "messageToUser": "<Hindi/Hinglish message to show user>"
}

VALID INTENTS:
  SEARCH_PRODUCT, ADD_ITEMS, REMOVE_ITEM, UPDATE_QUANTITY, SET_CUSTOMER,
  OPEN_REPORTS, OPEN_INVENTORY, SHOW_KHATA,
  CREATE_CUSTOMER, SET_PAYMENT, APPLY_DISCOUNT, CONFIRM_BILL,
  CANCEL_BILL, UPDATE_PRODUCT_PRICE, ADJUST_STOCK, DELETE_PRODUCT, EXPORT_DATA,
  UNKNOWN

RULES:
- If product is ambiguous (multiple possible matches), set clarificationNeeded=true and ask which product.
- If payment mode is missing for a bill action, ask for payment mode.
- If udhar is involved and customer mobile is missing, ask for mobile number.
- Risky actions (CANCEL_BILL, DELETE_PRODUCT etc.) must have needsConfirmation=true.
- Always respond in the language the user spoke (Hindi/Hinglish preferred for Indian shopkeepers).
- "kilo" or "kg" both mean kg. "litre" or "ltr" both mean ltr. "piece", "pcs", "nag" = piece.
- "baki udhar" or "baaki credit pe" means remaining amount goes to udhar/credit.
- Common product aliases: shakkar=sugar, chawal=rice, atta=flour, dal=lentils, tel=oil, namak=salt.

EXAMPLES:
Input: "Mohan ka bill banao mobile 9876500003 shakkar 2 kilo chawal 2 kilo 200 cash baki udhar"
Output: intent=ADD_ITEMS, customer={name:"Mohan",mobile:"9876500003"}, items=[{query:"shakkar",qty:2,unit:"kg"},{query:"chawal",qty:2,unit:"kg"}], payment={cash:200,remaining:"udhar"}, needsConfirmation=true

Input: "Aaj ka profit dikhao"
Output: intent=OPEN_REPORTS, target="daily", needsConfirmation=false

Input: "Last item hata do"
Output: intent=REMOVE_ITEM, target="last", needsConfirmation=false

Input: "Bill confirm karo"
Output: intent=CONFIRM_BILL, needsConfirmation=true
`;

// ─────────────────────────────────────────────────────────────
// PARSE COMMAND
// ─────────────────────────────────────────────────────────────
export async function parseCommand(shopId, userId, { transcript, context }) {
  const { client, model } = getClient();

  // Enrich prompt with cart context if available
  const userMessage = context
    ? `${transcript}\n\n[Current cart: ${JSON.stringify(context.currentCart ?? [])}]`
    : transcript;

  // Note: Groq does not support response_format: json_object on all models
  // Use a strong system prompt instruction instead — works on all providers
  const isGroq = !!env.GROQ_API_KEY && !env.OPENAI_API_KEY;

  const completion = await client.chat.completions.create({
    model,
    ...(isGroq ? {} : { response_format: { type: "json_object" } }),
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: userMessage },
    ],
    temperature: 0.1,
  });

  let parsed;
  try {
    parsed = JSON.parse(completion.choices[0].message.content);
  } catch {
    throw new Error("OpenAI returned invalid JSON");
  }

  // Run through permission engine
  const permission = checkPermission(parsed);
  parsed.permissionLevel = permission.level;
  parsed.permissionAllowed = permission.allowed;
  if (!permission.allowed) {
    parsed.messageToUser = `Ye action allowed nahi hai: ${permission.reason}`;
  }

  // Log every AI action
  await db.aiActionLog.create({
    data: {
      shopId,
      userId: userId ?? null,
      transcript,
      parsedActionJson: JSON.stringify(parsed),
      permissionLevel: permission.level,
      status: "parsed",
    },
  });

  return parsed;
}

// ─────────────────────────────────────────────────────────────
// LOG ACTION OUTCOME
// Frontend calls this after executing (or rejecting) an AI command
// ─────────────────────────────────────────────────────────────
export async function logAction(shopId, userId, { transcript, parsedAction, status, error }) {
  return db.aiActionLog.create({
    data: {
      shopId,
      userId: userId ?? null,
      transcript,
      parsedActionJson: JSON.stringify(parsedAction),
      permissionLevel: parsedAction?.permissionLevel ?? "unknown",
      status,
      error: error ?? null,
    },
  });
}
