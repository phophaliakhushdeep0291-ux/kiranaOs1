import { useEffect, useState } from "react";

/**
 * How much of the layout viewport the on-screen keyboard is currently covering.
 *
 * A full-screen panel sized with `100dvh` does NOT shrink when the keyboard opens:
 * `dvh` tracks browser chrome, not the keyboard. So a panel that pins its action
 * row to its own bottom edge puts that row underneath the keyboard the moment any
 * field is focused — on the add-product form that is the Save button, roughly
 * 300px below the fold, in a form with several screens of content. The cashier
 * types, then finds nothing to tap.
 *
 * Chrome answers this declaratively via `interactive-widget=resizes-content` in
 * the viewport meta, which shrinks the layout viewport (and therefore `dvh`) so
 * the panel resizes on its own. iOS Safari does not support that, and only moves
 * the VISUAL viewport — so this hook exists for iOS and for any browser where the
 * meta is not honoured. Where the meta already works, `visualViewport.height`
 * matches `innerHeight` and this returns 0, changing nothing.
 *
 * Returns 0 whenever the keyboard is closed, on desktop, and during SSR, so a
 * caller can treat "0" as "do not interfere".
 */
export function useKeyboardInset(): number {
  const [inset, setInset] = useState(0);

  useEffect(() => {
    const viewport = typeof window === "undefined" ? null : window.visualViewport;
    if (!viewport) return;

    const update = () => {
      // offsetTop matters because iOS scrolls the visual viewport up to keep the
      // focused field above the keyboard: without it the covered strip is
      // under-measured by exactly that scroll and the action row still hides.
      const covered = window.innerHeight - viewport.height - viewport.offsetTop;
      // A few pixels of difference are normal browser chrome jitter rather than a
      // keyboard, and reacting to those would resize the panel while someone is
      // simply scrolling.
      setInset(covered > 80 ? Math.round(covered) : 0);
    };

    update();
    viewport.addEventListener("resize", update);
    viewport.addEventListener("scroll", update);
    return () => {
      viewport.removeEventListener("resize", update);
      viewport.removeEventListener("scroll", update);
    };
  }, []);

  return inset;
}
