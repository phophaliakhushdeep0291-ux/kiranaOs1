/**
 * Complete, unambiguous report requests can use the same guarded tools without
 * paying for a model to select them and then write prose we cannot trust.
 * Exact sentence shapes are intentional: compound requests, named products,
 * comparisons and ambiguous "kal" still go through the normal agent.
 */
export function quickAnswer(message) {
  const text = String(message ?? "").normalize("NFKC").toLowerCase()
    .replace(/[’']/g, "").replace(/[?!.।]+$/u, "").trim().replace(/\s+/g, " ");
  const simple = text.replace(/^(?:please |show me |show |tell me |what is |what are |whats )/, "")
    .replace(/ please$/, "");
  const periods = new Map([
    ["today", "today"], ["todays", "today"], ["yesterday", "yesterday"], ["yesterdays", "yesterday"],
    ["this month", "month"], ["this months", "month"], ["last 7 days", "week"],
    ["this quarter", "quarter"], ["this year", "year"],
  ]);
  const period = "(today|todays|yesterday|yesterdays|this month|this months|last 7 days|this quarter|this year)";
  const metric = "((?:total )?(?:sales|revenue)|gross profit)";
  const forward = simple.match(new RegExp(`^${period} ${metric}(?: summary)?$`));
  const reverse = simple.match(new RegExp(`^${metric}(?: summary)? (?:for )?${period}$`));
  if (forward || reverse) {
    const range = periods.get(forward?.[1] ?? reverse[2]);
    const requested = forward?.[2] ?? reverse[1];
    return { tool: "get_sales_summary", args: { range, ...(requested === "gross profit" ? { includeProfit: true } : {}) } };
  }
  if (/^(?:aaj(?: ki)? (?:bikri|sales)(?: kitni (?:hui|hai))?|आज(?: की)? बिक्री(?: कितनी (?:हुई|है))?)$/u.test(simple)) {
    return { tool: "get_sales_summary", args: { range: "today" } };
  }
  if (/^(?:inventory health|stock health|stock summary)$/u.test(simple)) {
    return { tool: "get_inventory_health", args: {} };
  }
  if (/^(?:total outstanding credit|total udhar|total udhaar|कुल उधार|कुल बकाया)$/u.test(simple)) {
    return { tool: "get_udhar_summary", args: {} };
  }
  return null;
}
