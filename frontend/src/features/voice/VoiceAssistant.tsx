import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "wouter";
import { Bot, GripVertical, Mic, MicOff, SendHorizonal, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { executeVoiceAction } from "./voice-actions";
import { parseLocalVoiceIntent } from "./voice-command-parser";
import { askAiIntent } from "./voice-ai-client";
import { createOneShotRecognition, getSpeechRecognitionConstructor, shouldAcceptFinalTranscript, voiceTranscriptKey } from "./voice-recognition";
import type { SpeechRecognitionLike, VoiceToastPayload } from "./voice-types";

type AssistantPosition = { x: number; y: number };

const VOICE_ASSISTANT_POSITION_KEY = "kirana:voice-assistant-position";
const FLOATING_MARGIN = 12;
const MOBILE_BOTTOM_NAV_OFFSET = 84;

function getFloatingBottomOffset(): number {
  if (typeof window === "undefined") return FLOATING_MARGIN + 4;
  return window.innerWidth < 1024 ? MOBILE_BOTTOM_NAV_OFFSET : FLOATING_MARGIN + 4;
}

function readStoredAssistantPosition(): AssistantPosition | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(VOICE_ASSISTANT_POSITION_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AssistantPosition>;
    if (typeof parsed.x !== "number" || typeof parsed.y !== "number") return null;
    if (!Number.isFinite(parsed.x) || !Number.isFinite(parsed.y)) return null;
    return { x: parsed.x, y: parsed.y };
  } catch {
    return null;
  }
}

function clampAssistantPosition(position: AssistantPosition, width: number, height: number): AssistantPosition {
  if (typeof window === "undefined") return position;
  const safeWidth = Math.max(1, width);
  const safeHeight = Math.max(1, height);
  const maxX = Math.max(FLOATING_MARGIN, window.innerWidth - safeWidth - FLOATING_MARGIN);
  const maxY = Math.max(FLOATING_MARGIN, window.innerHeight - safeHeight - getFloatingBottomOffset());
  return {
    x: Math.min(Math.max(FLOATING_MARGIN, Math.round(position.x)), maxX),
    y: Math.min(Math.max(FLOATING_MARGIN, Math.round(position.y)), maxY),
  };
}

function saveAssistantPosition(position: AssistantPosition): void {
  try {
    window.localStorage.setItem(VOICE_ASSISTANT_POSITION_KEY, JSON.stringify(position));
  } catch {
    // Position is only a UI preference.
  }
}

export function VoiceAssistant() {
  const [location, setLocation] = useLocation();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [command, setCommand] = useState("");
  const [listening, setListening] = useState(false);
  const [status, setStatus] = useState("Say: open billing, search product chini, add customer Ramesh, record payment Ramesh 500 cash, or pending sync count.");
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const lastCapturedTranscriptRef = useRef<{ key: string; at: number } | null>(null);
  const lastProcessedTranscriptRef = useRef<{ key: string; at: number } | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const livePositionRef = useRef<AssistantPosition | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const [position, setPosition] = useState<AssistantPosition | null>(readStoredAssistantPosition);
  const [dragging, setDragging] = useState(false);
  const Recognition = useMemo(() => getSpeechRecognitionConstructor(), []);
  const floatingStyle = useMemo<CSSProperties>(() => {
    if (!position) return { bottom: getFloatingBottomOffset(), right: FLOATING_MARGIN + 4 };
    return { left: position.x, top: position.y };
  }, [position]);
  const assistantIsIdle = !open && !dragging;

  useEffect(() => {
    livePositionRef.current = position;
  }, [position]);

  useEffect(() => {
    return () => {
      if (dragFrameRef.current !== null) window.cancelAnimationFrame(dragFrameRef.current);
    };
  }, []);

  useEffect(() => {
    const clampCurrentPosition = () => {
      const current = livePositionRef.current;
      const rect = containerRef.current?.getBoundingClientRect();
      if (!current || !rect) return;
      const next = clampAssistantPosition(current, rect.width, rect.height);
      livePositionRef.current = next;
      setPosition(next);
      saveAssistantPosition(next);
    };

    clampCurrentPosition();
    window.addEventListener("resize", clampCurrentPosition);
    return () => window.removeEventListener("resize", clampCurrentPosition);
  }, [open]);

  const showToast = (payload: VoiceToastPayload) => toast(payload);

  const handleMovePointerDown = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    if (event.button !== 0) return;
    const container = containerRef.current;
    if (!container) return;

    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture?.(event.pointerId);

    const rect = container.getBoundingClientRect();
    const offsetX = event.clientX - rect.left;
    const offsetY = event.clientY - rect.top;
    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "grabbing";
    document.body.style.userSelect = "none";
    setDragging(true);

    const updatePosition = (next: AssistantPosition) => {
      livePositionRef.current = next;
      if (dragFrameRef.current !== null) return;
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        setPosition(livePositionRef.current);
      });
    };

    const handlePointerMove = (moveEvent: PointerEvent) => {
      updatePosition(clampAssistantPosition(
        { x: moveEvent.clientX - offsetX, y: moveEvent.clientY - offsetY },
        rect.width,
        rect.height,
      ));
    };

    const handlePointerUp = () => {
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      const next = livePositionRef.current ?? clampAssistantPosition({ x: rect.left, y: rect.top }, rect.width, rect.height);
      setPosition(next);
      saveAssistantPosition(next);
      setDragging(false);
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };

    updatePosition(clampAssistantPosition({ x: rect.left, y: rect.top }, rect.width, rect.height));
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp, { once: true });
  }, []);

  function stopMic() {
    recognitionRef.current?.stop?.();
    recognitionRef.current = null;
    setListening(false);
  }

  function startMic() {
    if (!Recognition) {
      setStatus("Voice recognition is not available in this browser. Use Chrome/Edge or type the command.");
      setOpen(true);
      return;
    }
    if (listening) {
      stopMic();
      return;
    }

    const recognition = createOneShotRecognition(Recognition, {
      onStart: () => {
        setOpen(true);
        setListening(true);
        setStatus("Listening once. Speak one complete command, then wait.");
      },
      onTranscript: (text) => {
        const now = Date.now();
        if (!shouldAcceptFinalTranscript(text, lastCapturedTranscriptRef.current, now)) {
          setStatus("Duplicate voice result ignored. Review the captured command and press Run.");
          return;
        }
        lastCapturedTranscriptRef.current = { key: voiceTranscriptKey(text), at: now };
        setCommand(text);
        setStatus("Command captured. Review it and press Run.");
      },
      onError: (message, variant) => {
        setStatus(message);
        toast({ title: "Voice assistant", description: message, variant });
      },
      onEnd: () => {
        setListening(false);
        recognitionRef.current = null;
      },
    });

    recognitionRef.current = recognition;
    try {
      recognition.start();
    } catch {
      setStatus("Mic could not start. Refresh the page or type the command.");
      setListening(false);
      recognitionRef.current = null;
    }
  }

  async function runCommand(input = command) {
    const spoken = input.trim();
    if (!spoken) {
      setStatus("Type or speak a command first.");
      return;
    }

    const now = Date.now();
    if (!shouldAcceptFinalTranscript(spoken, lastProcessedTranscriptRef.current, now)) {
      setStatus("Duplicate command ignored. Say a new command or edit the text before running again.");
      setCommand("");
      return;
    }

    setStatus("Understanding command...");
    const local = parseLocalVoiceIntent(spoken, location);
    const preferLocalContext = location.startsWith("/products") && local.action === "product_draft";
    const aiIntent = preferLocalContext ? null : await askAiIntent(spoken);
    const intent = aiIntent && aiIntent.action !== "noop" ? aiIntent : local;

    await executeVoiceAction({
      spoken,
      intent,
      currentLocation: location,
      setLocation,
      setStatus,
      toast: showToast,
    });

    lastProcessedTranscriptRef.current = { key: voiceTranscriptKey(spoken), at: Date.now() };
    setCommand("");
  }

  return (
    <div
      ref={containerRef}
      className={`fixed z-50 print:hidden transition-opacity duration-200 ${assistantIsIdle ? "opacity-[0.38] hover:opacity-100 focus-within:opacity-100" : "opacity-100"} ${dragging ? "select-none" : ""}`}
      style={floatingStyle}
    >
      {open && (
        <div className={`mb-3 w-[min(92vw,420px)] rounded-lg border bg-card p-3 shadow-2xl transition-transform duration-150 ${dragging ? "scale-[1.01]" : ""}`}>
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 font-semibold">
              <button
                type="button"
                aria-label="Move voice assistant"
                title="Move voice assistant"
                onPointerDown={handleMovePointerDown}
                className="flex h-8 w-8 cursor-grab items-center justify-center rounded-md text-muted-foreground transition hover:bg-muted hover:text-foreground active:cursor-grabbing"
              >
                <GripVertical className="h-4 w-4" aria-hidden="true" />
              </button>
              <Bot className="h-4 w-4 text-primary" />
              AI voice assistant
            </div>
            <Button type="button" size="icon" variant="ghost" className="h-8 w-8" onClick={() => setOpen(false)}><X className="h-4 w-4" /></Button>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Control app pages and prepare product, customer, inventory, billing, payment, and search drafts. Nothing financial or sensitive is saved without review.</p>
          <Textarea
            value={command}
            onChange={(event) => setCommand(event.target.value)}
            className="mt-3 min-h-20 resize-none"
            placeholder="Try: open products / search product chini / add product chini cost 40 selling 45 / record payment Ramesh 500 cash / pending sync count"
          />
          <div className="mt-2 flex flex-wrap gap-2">
            <Button type="button" variant={listening ? "destructive" : "outline"} onClick={startMic}>
              {listening ? <MicOff className="mr-2 h-4 w-4" /> : <Mic className="mr-2 h-4 w-4" />}
              {listening ? "Stop" : "Speak"}
            </Button>
            <Button type="button" onClick={() => void runCommand()}><SendHorizonal className="mr-2 h-4 w-4" />Run</Button>
            <Button type="button" variant="secondary" onClick={() => void runCommand("add product chini cost 40 selling 45 stock 10 kg")}>Product demo</Button>
            <Button type="button" variant="secondary" onClick={() => void runCommand("purchase 10 kilo chini cost 40")}>Inventory demo</Button>
          </div>
          <div className="mt-2 rounded-lg bg-muted px-3 py-2 text-xs text-muted-foreground">{status}</div>
          <Badge variant="outline" className="mt-2">AI used when backend proxy is configured</Badge>
        </div>
      )}
      <div className={`flex justify-end gap-1.5 transition-all duration-200 ${assistantIsIdle ? "scale-95" : "scale-100"}`}>
        <button
          type="button"
          aria-label="Move voice assistant"
          title="Move voice assistant"
          onPointerDown={handleMovePointerDown}
          className={`flex cursor-grab items-center justify-center rounded-full border backdrop-blur-md transition-all duration-200 active:cursor-grabbing ${open ? "h-10 w-9 bg-card text-muted-foreground shadow-xl hover:bg-muted hover:text-foreground" : "h-9 w-8 bg-background/25 text-muted-foreground/45 shadow-sm hover:-translate-y-0.5 hover:bg-sidebar hover:text-sidebar-foreground hover:shadow-xl"}`}
        >
          <GripVertical className="h-4 w-4" aria-hidden="true" />
        </button>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={`rounded-full border backdrop-blur-md transition-all duration-200 ${open ? "h-10 w-10 bg-primary text-primary-foreground shadow-xl hover:bg-primary/90 hover:text-primary-foreground" : "h-10 w-10 bg-background/30 text-muted-foreground/55 shadow-md hover:-translate-y-0.5 hover:bg-sidebar hover:text-sidebar-foreground hover:shadow-2xl"}`}
          onClick={() => (open ? startMic() : setOpen(true))}
        >
          <Mic className="h-4 w-4" aria-hidden="true" />
          <span className="sr-only">Voice assistant</span>
        </Button>
      </div>
    </div>
  );
}
