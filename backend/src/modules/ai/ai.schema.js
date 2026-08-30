import { z } from "zod";

const boundedProductContext = z.object({
  id: z.string().max(100).optional(),
  productId: z.string().max(100).optional(),
  name: z.string().max(120).optional(),
  productName: z.string().max(120).optional(),
  quantity: z.number().finite().min(0).max(1_000_000).optional(),
  unit: z.string().max(30).optional(),
});

export const parseCommandSchema = z.object({
  transcript: z.string().trim().min(1, "Transcript cannot be empty").max(2_000),
  context: z.object({
    currentCart: z.array(boundedProductContext).max(50).optional(),
    currentCustomer: z.object({
      name: z.string().max(100).optional(),
      mobile: z.string().max(30).optional(),
    }).optional(),
    visibleProducts: z.array(boundedProductContext).max(100).optional(),
    currentScreen: z.string().max(160).optional(),
  }).strict().optional(),
}).strict();

/**
 * One turn of conversation with the agent.
 *
 * History is capped here as well as in the service: an unbounded transcript is
 * a way to push the system prompt out of the model's attention, and it is a way
 * to run up a token bill on someone else's key.
 */
export const agentChatSchema = z.object({
  message: z.string().trim().min(1, "Say what you need").max(2_000),
  history: z.array(z.object({
    role: z.enum(["user", "assistant"]),
    content: z.string().max(4_000),
  }).strict()).max(20).optional(),
  // The shop's UI language. Optional, and absent means Hindi rather than
  // English: that is this app's default, and a till that omits the field is far
  // more likely to be a Hindi shop than an English one.
  language: z.enum(["hi", "en"]).optional(),
  // The bill open on the counter, sent only from the till. Read-only context:
  // it lets "make it three kilo" and "what is this bill" mean something, and
  // nothing the agent does writes back through it.
  cart: z.array(z.object({
    name: z.string().max(120),
    quantity: z.number().finite().min(0).max(1_000_000),
    unit: z.string().max(30).optional(),
    rate: z.number().finite().min(0).max(10_000_000).optional(),
  }).strict()).max(40).optional(),
}).strict();

/**
 * The plan is referenced, never re-sent. A body carrying tool names and
 * arguments would be a way around both the model and the confirmation the
 * shopkeeper just gave.
 */
export const agentPlanSchema = z.object({
  planId: z.string().trim().min(1).max(60),
}).strict();

export const logActionSchema = z.object({
  transcript: z.string().max(2_000),
  parsedAction: z.record(z.unknown()),
  status: z.enum(["executed", "rejected", "failed", "blocked"]),
  error: z.string().max(500).optional(),
}).strict();
