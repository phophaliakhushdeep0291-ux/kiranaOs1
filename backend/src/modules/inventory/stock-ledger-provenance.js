/**
 * The common attribution shape for every StockLedger writer.
 *
 * `actorName` is a snapshot rather than a relation-only display value: a ledger
 * must remain understandable after staff rename/deactivation. Legacy rows stay
 * nullable and are labelled at the read/UI boundary instead of fabricating a
 * historical person. New system-driven rows are explicit about being system work.
 */
export function stockLedgerProvenance(actor = {}, systemName = "KiranaOS system") {
  const actorUserId = actor?.userId ?? actor?.id ?? null;
  const suppliedName = actor?.userName ?? actor?.name ?? actor?.email ?? null;
  const actorName = typeof suppliedName === "string" && suppliedName.trim()
    ? suppliedName.trim()
    : actorUserId
      ? "Authenticated staff"
      : systemName;
  return { actorUserId, actorName };
}
