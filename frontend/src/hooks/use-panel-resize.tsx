import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";

interface Options {
  defaultWidth?: number;
  min?: number;
  max?: number;
}

function readStored(key: string, def: number, min: number, max: number) {
  try {
    const raw = Number(localStorage.getItem(key));
    return Number.isFinite(raw) && raw >= min ? Math.min(raw, max) : def;
  } catch {
    return def;
  }
}

/**
 * Width state for a right-docked slide-in panel, with a drag handle and
 * localStorage persistence. `onResizeStart` is a mousedown handler for a
 * left-edge handle; dragging left widens the panel. `isResizing` lets callers
 * drop the width/padding transition during an active drag so it tracks the
 * cursor 1:1 (the transition is only wanted for the open/close slide).
 */
export function usePanelResize(storageKey: string, { defaultWidth = 420, min = 360, max = 760 }: Options = {}) {
  const [width, setWidth] = useState(() => readStored(storageKey, defaultWidth, min, max));
  const [isResizing, setIsResizing] = useState(false);
  const [isDesktop, setIsDesktop] = useState(() => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches);
  const frame = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia("(min-width: 1024px)");
    const onChange = () => setIsDesktop(mq.matches);
    setIsDesktop(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    try { localStorage.setItem(storageKey, String(Math.round(width))); } catch { /* ignore */ }
  }, [storageKey, width]);

  useEffect(() => () => { if (frame.current !== null) cancelAnimationFrame(frame.current); }, []);

  const onResizeStart = useCallback((event: ReactMouseEvent) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = width;
    let latestX = startX;
    const clamp = (x: number) => Math.min(max, Math.max(min, startWidth - (x - startX)));

    setIsResizing(true);
    const prevCursor = document.body.style.cursor;
    const prevSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMove = (e: MouseEvent) => {
      latestX = e.clientX;
      if (frame.current !== null) return;
      frame.current = requestAnimationFrame(() => {
        frame.current = null;
        setWidth(clamp(latestX));
      });
    };
    const onUp = () => {
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
      setWidth(clamp(latestX));
      setIsResizing(false);
      document.body.style.cursor = prevCursor;
      document.body.style.userSelect = prevSelect;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [width, min, max]);

  return { width, isResizing, isDesktop, onResizeStart };
}

/** Drag handle for the left edge of a docked panel. */
export function PanelResizeHandle({ onResizeStart }: { onResizeStart: (e: ReactMouseEvent) => void }) {
  return (
    <div
      onMouseDown={onResizeStart}
      title="Drag to resize"
      className="group absolute inset-y-0 left-0 z-10 hidden w-2.5 -translate-x-1/2 cursor-col-resize lg:block"
    >
      <span className="mx-auto block h-full w-1 bg-transparent transition-colors group-hover:bg-[#0057ff]/30" />
    </div>
  );
}
