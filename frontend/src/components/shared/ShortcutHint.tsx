import { cn } from "@/lib/utils";

export function ShortcutHint({ keys, label, className }: { keys: string; label?: string; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border bg-background/70 px-2 py-1 text-xs font-medium text-muted-foreground shadow-xs", className)}>
      <kbd className="rounded bg-muted px-1.5 py-0.5 font-mono text-[11px] text-foreground">{keys}</kbd>
      {label && <span>{label}</span>}
    </span>
  );
}
