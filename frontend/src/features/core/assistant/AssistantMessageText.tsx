// Unicode bidi can visually reorder ISO dates and move a currency symbol even
// though the underlying reply is correct. Isolate factual tokens from RTL prose.
export function assistantTextParts(text: string) {
  return text.split(/("(?:[^"\\]|\\.)*"|(?:[₹$€£]|AED\s*|INR\s*)?-?\d+(?:[.,:/-]\d+)*(?:%)?)/gu);
}

export function AssistantMessageText({ text }: { text: string }) {
  return <>{assistantTextParts(text).map((part, index) => index % 2
    ? <bdi key={index} dir={part.startsWith('"') ? "auto" : "ltr"}>{part}</bdi>
    : part)}</>;
}
