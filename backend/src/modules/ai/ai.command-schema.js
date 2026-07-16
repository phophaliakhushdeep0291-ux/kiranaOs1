import { z } from "zod";

export const AI_INTENTS = Object.freeze({
  SEARCH_PRODUCT: "SEARCH_PRODUCT",
  ADD_ITEMS: "ADD_ITEMS",
  REMOVE_ITEM: "REMOVE_ITEM",
  UPDATE_QUANTITY: "UPDATE_QUANTITY",
  SET_CUSTOMER: "SET_CUSTOMER",
  OPEN_REPORTS: "OPEN_REPORTS",
  OPEN_INVENTORY: "OPEN_INVENTORY",
  SHOW_KHATA: "SHOW_KHATA",
  CREATE_CUSTOMER: "CREATE_CUSTOMER",
  SET_PAYMENT: "SET_PAYMENT",
  APPLY_DISCOUNT: "APPLY_DISCOUNT",
  CONFIRM_BILL: "CONFIRM_BILL",
  CANCEL_BILL: "CANCEL_BILL",
  UPDATE_PRODUCT_PRICE: "UPDATE_PRODUCT_PRICE",
  ADJUST_STOCK: "ADJUST_STOCK",
  DELETE_PRODUCT: "DELETE_PRODUCT",
  EXPORT_DATA: "EXPORT_DATA",
  UNKNOWN: "UNKNOWN",
});

export const AI_INTENT_VALUES = Object.freeze(Object.values(AI_INTENTS));

export const AI_COMMAND_JSON_SCHEMA = Object.freeze({
  name: "kiranaos_ai_command",
  strict: true,
  schema: {
    type: "object",
    additionalProperties: false,
    properties: {
      intent: {
        type: "string",
        enum: AI_INTENT_VALUES,
        description: "The single app command that best matches the user transcript.",
      },
      confidence: {
        type: "number",
        minimum: 0,
        maximum: 1,
        description: "Parser confidence from 0 to 1.",
      },
      customer: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              name: { type: ["string", "null"] },
              mobile: { type: ["string", "null"] },
            },
            required: ["name", "mobile"],
          },
          { type: "null" },
        ],
      },
      items: {
        anyOf: [
          {
            type: "array",
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                query: { type: "string" },
                quantity: { type: "number" },
                unit: {
                  type: "string",
                  enum: ["kg", "g", "ltr", "ml", "piece", "pcs", "packet", "box", "dozen", "unknown"],
                },
              },
              required: ["query", "quantity", "unit"],
            },
          },
          { type: "null" },
        ],
      },
      payment: {
        anyOf: [
          {
            type: "object",
            additionalProperties: false,
            properties: {
              cash: { type: ["number", "null"] },
              upi: { type: ["number", "null"] },
              remaining: { type: ["string", "null"], enum: ["udhar", null] },
            },
            required: ["cash", "upi", "remaining"],
          },
          { type: "null" },
        ],
      },
      target: { type: ["string", "null"] },
      discount: { type: ["number", "null"] },
      needsConfirmation: { type: "boolean" },
      clarificationNeeded: { type: "boolean" },
      clarificationQuestion: { type: ["string", "null"] },
      messageToUser: { type: "string" },
    },
    required: [
      "intent",
      "confidence",
      "customer",
      "items",
      "payment",
      "target",
      "discount",
      "needsConfirmation",
      "clarificationNeeded",
      "clarificationQuestion",
      "messageToUser",
    ],
  },
});

const nullableText = (max) => z.string().trim().min(1).max(max).nullable();
const optionalMoney = z.number().finite().min(0).max(100_000_000).nullable();

export const AI_COMMAND_OUTPUT_SCHEMA = z.object({
  intent: z.enum(AI_INTENT_VALUES),
  confidence: z.number().finite().min(0).max(1),
  customer: z.object({
    name: nullableText(100),
    mobile: z.string().trim().regex(/^\d{10}$/, "mobile must be 10 digits").nullable(),
  }).strict().nullable(),
  items: z.array(z.object({
    query: z.string().trim().min(1).max(120),
    quantity: z.number().finite().positive().max(1_000_000),
    unit: z.enum(["kg", "g", "ltr", "ml", "piece", "pcs", "packet", "box", "dozen", "unknown"]),
  }).strict()).max(50).nullable(),
  payment: z.object({
    cash: optionalMoney,
    upi: optionalMoney,
    remaining: z.enum(["udhar"]).nullable(),
  }).strict().nullable(),
  target: nullableText(160),
  discount: optionalMoney,
  needsConfirmation: z.boolean(),
  clarificationNeeded: z.boolean(),
  clarificationQuestion: nullableText(300),
  messageToUser: z.string().trim().min(1).max(500),
}).strict();

export function safeUnknownAiCommand(message = "Command samajh nahi aaya. Please rephrase it.") {
  return {
    intent: AI_INTENTS.UNKNOWN,
    confidence: 0,
    customer: null,
    items: null,
    payment: null,
    target: null,
    discount: null,
    needsConfirmation: true,
    clarificationNeeded: true,
    clarificationQuestion: "Please say one clear action with the exact item, customer, and amount.",
    messageToUser: message,
  };
}

export function parseAiCommandOutput(value) {
  const result = AI_COMMAND_OUTPUT_SCHEMA.safeParse(value);
  if (result.success) return { ok: true, command: result.data, issues: [] };
  return {
    ok: false,
    command: safeUnknownAiCommand("The AI response could not be verified. Please rephrase the command."),
    issues: result.error.issues.slice(0, 10).map((issue) => ({
      path: issue.path.join("."),
      code: issue.code,
    })),
  };
}

export function normalizeAiCommand(command) {
  const safeCommand = command && typeof command === "object" ? command : {};
  const intent = AI_INTENT_VALUES.includes(safeCommand.intent) ? safeCommand.intent : AI_INTENTS.UNKNOWN;

  return {
    intent,
    confidence: typeof safeCommand.confidence === "number" ? Math.max(0, Math.min(1, safeCommand.confidence)) : 0,
    customer: safeCommand.customer ?? null,
    items: Array.isArray(safeCommand.items) ? safeCommand.items : null,
    payment: safeCommand.payment ?? null,
    target: safeCommand.target ?? null,
    discount: typeof safeCommand.discount === "number" ? safeCommand.discount : null,
    needsConfirmation: Boolean(safeCommand.needsConfirmation),
    clarificationNeeded: Boolean(safeCommand.clarificationNeeded),
    clarificationQuestion: safeCommand.clarificationQuestion ?? null,
    messageToUser: typeof safeCommand.messageToUser === "string" ? safeCommand.messageToUser : "Command samajh nahi aaya.",
  };
}

export function getAiSchemaSummary() {
  return {
    name: AI_COMMAND_JSON_SCHEMA.name,
    strict: AI_COMMAND_JSON_SCHEMA.strict,
    intents: AI_INTENT_VALUES,
    requiredFields: AI_COMMAND_JSON_SCHEMA.schema.required,
  };
}
