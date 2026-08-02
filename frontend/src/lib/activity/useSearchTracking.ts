import { useCallback, useEffect, useRef } from "react";
import { ACTIVITY_EVENTS, type ActivityEventType } from "./events";
import { trackEvent } from "./activityClient";

/** How long the query must stop changing before it counts as one search. */
const SETTLE_MS = 900;

/**
 * useSearchTracking — exactly one PRODUCT_SEARCH (or CUSTOMER_SEARCH) event per
 * search, not one per keystroke and not one per search twice.
 *
 * Typing "maggi" would otherwise emit five events for "m", "ma", "mag", … and
 * "most searched products" would become a ranking of first letters. So the
 * query has to stop changing first, and the resulting event carries:
 *
 *  - `query` and `results`, the two fields the spec's example shows;
 *  - `durationMs`, first keystroke to settled — the spec's "average search
 *    duration";
 *  - `selectedProductId`, when the user then picks something. Selection is the
 *    only signal that a search actually worked, and it is what auto-complete
 *    learns from.
 *
 * A settled search is held rather than emitted, because the selection arrives
 * *after* it. It is flushed when the search is genuinely over: the user picks
 * something, types a different query, clears the box, or leaves the screen.
 * Emitting on a short timer instead looks equivalent but is not — a shopkeeper
 * reading three results takes several seconds, so the timer would fire first and
 * every successful search would be counted twice, once without its selection.
 */
export function useSearchTracking(
  query: string,
  resultCount: number,
  options?: { eventType?: ActivityEventType; screen?: string; enabled?: boolean },
) {
  const eventType = options?.eventType ?? ACTIVITY_EVENTS.PRODUCT_SEARCH;
  const enabled = options?.enabled ?? true;
  const screen = options?.screen;

  const startedAt = useRef<number | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<{ query: string; results: number; durationMs: number } | null>(null);
  const resultsRef = useRef(resultCount);
  resultsRef.current = resultCount;

  const flush = useCallback(
    (selected?: { id: string; name?: string }) => {
      const settled = pending.current;
      if (!settled) return;
      pending.current = null;
      trackEvent(
        eventType,
        {
          query: settled.query,
          results: settled.results,
          selectedProductId: selected?.id,
          selectedProduct: selected?.name,
        },
        { durationMs: settled.durationMs, screen },
      );
    },
    [eventType, screen],
  );

  useEffect(() => {
    if (!enabled) return;
    const trimmed = query.trim();
    if (timer.current) clearTimeout(timer.current);

    // The query moved on, so whatever was held is finished — without a
    // selection, which is itself the interesting case ("searched, found
    // nothing, tried again").
    if (pending.current && pending.current.query !== trimmed) flush();

    if (trimmed.length < 2) {
      startedAt.current = null;
      return;
    }
    if (startedAt.current === null) startedAt.current = Date.now();
    const began = startedAt.current;

    timer.current = setTimeout(() => {
      pending.current = { query: trimmed, results: resultsRef.current, durationMs: Date.now() - began };
      startedAt.current = null;
    }, SETTLE_MS);

    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [query, enabled, flush]);

  // Leaving the screen ends any search still held.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
      flush();
    };
  }, [flush]);

  /** Call when the user picks a result, to attribute the search to it. */
  const notifySelection = useCallback(
    (id: string, name?: string) => {
      if (timer.current) clearTimeout(timer.current);
      if (pending.current) {
        flush({ id, name });
        return;
      }
      // Picked before the query settled: record the search they were part-way
      // through typing. A pick with nothing typed is browsing, not searching —
      // the add-to-bill event already covers that.
      const began = startedAt.current;
      const typed = query.trim();
      startedAt.current = null;
      if (typed.length < 2) return;
      trackEvent(
        eventType,
        { query: typed, results: resultsRef.current, selectedProductId: id, selectedProduct: name },
        { durationMs: began === null ? undefined : Date.now() - began, screen },
      );
    },
    [flush, eventType, screen, query],
  );

  return { notifySelection };
}
