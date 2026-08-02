import { useCallback, useEffect, useRef } from "react";
import { ACTIVITY_EVENTS } from "./events";
import { flushActivity, setOnlineActivityShop, trackEvent } from "./activityClient";
import { sessionAgeMs } from "./session";

/**
 * Online-session tracking for the QR storefront (§13's online events).
 *
 * The storefront is a public page with no login, so these events go to the
 * public per-shop ingest and carry no user. What they do carry is the funnel the
 * owner cannot otherwise see: how many people opened the store, what they looked
 * at, what they put in a basket, and where they stopped.
 */

export interface OnlineCartSnapshot {
  itemCount: number;
  total: number;
  productIds: string[];
}

/**
 * useOnlineSession — start/end the session and detect an abandoned cart.
 *
 * "Abandoned" is decided at the moment the page goes away with items still in
 * the basket and no order placed. That is the only point at which abandonment is
 * actually knowable client-side; anything earlier would flag a shopper who is
 * still deciding.
 */
export function useOnlineSession(shopId: string | null | undefined, cart: OnlineCartSnapshot, ordered: boolean) {
  const started = useRef(false);
  const cartRef = useRef(cart);
  const orderedRef = useRef(ordered);
  cartRef.current = cart;
  orderedRef.current = ordered;

  useEffect(() => {
    if (!shopId) return;
    setOnlineActivityShop(shopId);
    if (!started.current) {
      started.current = true;
      trackEvent(ACTIVITY_EVENTS.ONLINE_SESSION_START, {});
    }
    return () => setOnlineActivityShop(null);
  }, [shopId]);

  useEffect(() => {
    if (!shopId) return;
    const closeSession = () => {
      const basket = cartRef.current;
      if (!orderedRef.current && basket.itemCount > 0) {
        trackEvent(ACTIVITY_EVENTS.ONLINE_CART_ABANDONED, {
          itemCount: basket.itemCount,
          total: basket.total,
          productIds: basket.productIds,
        });
      }
      trackEvent(ACTIVITY_EVENTS.ONLINE_SESSION_END, { ordered: orderedRef.current }, { durationMs: sessionAgeMs() });
      void flushActivity();
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") closeSession();
    };
    // pagehide is the reliable one on mobile Safari, which is most of this
    // page's traffic; visibilitychange covers the tab-switch case.
    window.addEventListener("pagehide", closeSession);
    window.addEventListener("visibilitychange", onVisibility);
    return () => {
      window.removeEventListener("pagehide", closeSession);
      window.removeEventListener("visibilitychange", onVisibility);
    };
  }, [shopId]);
}

// One impression per product per page load. A shopper scrolling up and down a
// category should not turn one product into forty views, or the "viewed but not
// bought" insight becomes a ranking of whatever sits mid-screen.
const seenProducts = new Set<string>();

/**
 * useOnlineProductImpression — ref callback that records a product as *seen*
 * when its card is actually on screen.
 *
 * Rendering is not seeing: a 200-product catalogue renders every card, and
 * counting those as views would make the view/cart-add ratio meaningless. The
 * observer waits for half the card to be visible.
 */
export function useOnlineProductImpression(productId: string, productName: string, enabled = true) {
  return useCallback(
    (node: HTMLElement | null) => {
      if (!enabled || !node || seenProducts.has(productId)) return;
      if (typeof IntersectionObserver === "undefined") return;
      const observer = new IntersectionObserver(
        (entries) => {
          for (const entry of entries) {
            if (!entry.isIntersecting) continue;
            if (seenProducts.has(productId)) break;
            seenProducts.add(productId);
            trackEvent(ACTIVITY_EVENTS.ONLINE_PRODUCT_VIEW, { productId, productName });
            observer.disconnect();
            break;
          }
        },
        { threshold: 0.5 },
      );
      observer.observe(node);
    },
    [productId, productName, enabled],
  );
}

/** Test seam — impressions are deduped for the life of the page. */
export function __resetOnlineImpressions(): void {
  seenProducts.clear();
}
