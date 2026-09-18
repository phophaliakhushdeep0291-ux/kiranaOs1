/**
 * Turning a ZodError into something a shopkeeper can act on.
 *
 * Zod gives two unhelpful shapes and we were shipping both.
 *
 * `error.flatten().fieldErrors` keys only the TOP level of the path, which is
 * documented and fine for a flat login form and useless for everything else
 * here. A bill whose third line is missing its unit comes back as
 * `{ items: ["Required"] }` — the one word that cannot tell you which of forty
 * lines to look at. That is what the HTTP 400 carried.
 *
 * `error.message` is the whole issue array re-serialised as multi-line JSON.
 * That is what the offline queue wrote into the parked row's reason, so a
 * shopkeeper's "needs review" card showed them a stack of JSON.
 *
 * Both callers want the same one sentence: which field, and what is wrong with
 * it. `items[0].enteredUnit is required` is actionable on the counter and in a
 * support call; neither of the above is.
 */

const MAX_NAMED_FIELDS = 3;
const MAX_ISSUES = 50;

/** ["items", 0, "enteredUnit"] → "items[0].enteredUnit" */
export function formatIssuePath(path) {
  if (!Array.isArray(path) || path.length === 0) return "";
  return path.reduce((acc, segment) => {
    if (typeof segment === "number") return `${acc}[${segment}]`;
    return acc ? `${acc}.${segment}` : String(segment);
  }, "");
}

function describeIssue(issue) {
  const field = formatIssuePath(issue?.path);
  const message = String(issue?.message ?? "is invalid").trim();
  if (!field) return message;
  // Zod's bare "Required" reads as a fragment on its own; every other message
  // is already a sentence about the field and only needs the field's name.
  if (/^required$/i.test(message)) return `${field} is required`;
  return `${field}: ${message}`;
}

/** [{ field, message }] with the full path preserved, for logs and support. */
export function zodIssueList(error) {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  return issues.slice(0, MAX_ISSUES).map((issue) => ({
    field: formatIssuePath(issue?.path),
    message: String(issue?.message ?? "is invalid"),
  }));
}

/**
 * One line naming the fields that failed. Names the first few and counts the
 * rest, because a client that posts a malformed forty-line bill would otherwise
 * get a paragraph — and the first three are enough to find the bug.
 */
export function describeZodError(error, fallback = "Validation failed") {
  const issues = Array.isArray(error?.issues) ? error.issues : [];
  if (issues.length === 0) return fallback;

  const described = issues.slice(0, MAX_NAMED_FIELDS).map(describeIssue).filter(Boolean);
  if (described.length === 0) return fallback;

  const remaining = issues.length - described.length;
  const tail = remaining > 0 ? `, and ${remaining} more problem${remaining === 1 ? "" : "s"}` : "";
  return `${fallback}: ${described.join("; ")}${tail}`;
}
