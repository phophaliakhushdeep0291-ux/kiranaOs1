// The conversational assistant: its panel, its proposals, and the confirmation
// a shopkeeper gives before anything changes.
//
// The confirmation strings carry more weight than most UI copy, because they are
// what someone reads before agreeing to a change to their stock or their prices.
// They stay plain and concrete for that reason.
export const assistantEn = {
  "assistant.title": "Assistant",
  "assistant.subtitle": "Ask about your shop, or tell it what to change",
  "assistant.open": "Open assistant",
  "assistant.close": "Close",
  "assistant.inputPlaceholder": "Ask anything about your shop…",
  "assistant.send": "Send",
  "assistant.thinking": "Looking it up…",
  "assistant.clear": "Start over",
  "assistant.speak": "Speak",
  "assistant.listening": "Listening… tap to stop",
  "assistant.transcribing": "Writing down what you said…",
  "assistant.micDenied": "Microphone access was refused. Type instead.",

  "assistant.emptyTitle": "What would you like to know?",
  "assistant.emptyBody": "It can read your stock, sales, customers and udhar, and prepare changes for you to confirm.",
  "assistant.example.sales": "How much did I sell this week?",
  "assistant.example.lowStock": "What is running out?",
  "assistant.example.udhar": "Who owes me the most?",
  "assistant.example.price": "Change sugar's price to 45",

  "assistant.planTitle": "Waiting for your confirmation",
  "assistant.planNote": "Nothing has changed yet.",
  "assistant.confirm": "Confirm",
  "assistant.reject": "Cancel",
  "assistant.confirming": "Applying…",
  "assistant.confirmed": "Done",
  "assistant.rejected": "Cancelled",
  "assistant.partialFailure": "Some changes could not be applied",
  "assistant.openBill": "Open the bill ({count} items added)",
  "assistant.till.title": "Assistant",
  "assistant.till.thinking": "Working it out…",
  "assistant.till.apply": "Add to this bill",
  "assistant.till.dismiss": "Dismiss",
  "assistant.till.applied": "Added to the bill",
  "assistant.till.nothingToAdd": "Nothing to add from that.",

  "assistant.ownerPinTitle": "Owner PIN needed",
  "assistant.ownerPinBody": "This changes prices or stock, so it needs the owner's 4-digit PIN.",
  "assistant.ownerPinPlaceholder": "4-digit PIN",
  "assistant.ownerPinSubmit": "Confirm with PIN",
  "assistant.ownerPinWrong": "That PIN was not accepted",

  "assistant.sourcesTitle": "What it read",
  "assistant.sourcesToggle": "Show what it read",
  "assistant.sourcesHide": "Hide",

  "assistant.offline": "The assistant needs a connection. Voice commands still work offline.",
  "assistant.unavailable": "The assistant is not set up on this server.",
  "assistant.busy": "The assistant is busy. Try again in a moment.",
  "assistant.failed": "That did not work. Try rephrasing it.",
  "assistant.feedback.question": "Was this right?",
  "assistant.feedback.correct": "Correct",
  "assistant.feedback.misunderstood": "Misunderstood",
  "assistant.feedback.unsafe": "Unsafe",
  "assistant.feedback.thanks": "Feedback recorded — no message or customer data was copied.",
  "assistant.feedback.failed": "Feedback was not saved. Try again.",
} as const;
