import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic } from "lucide-react";
import { useAppLanguage } from "@/features/settings/i18n";
import type { VoiceParsedDraft } from "../billing-types";

interface BillingVoicePanelProps {
  voiceCommand: string;
  onVoiceCommandChange: (value: string) => void;
  voiceListening: boolean;
  voiceMicMessage: string;
  voiceDraft: VoiceParsedDraft | null;
  onStartVoiceListening: () => void;
  onParseVoiceDraft: () => void;
  onAddVoiceDraftToCart: () => void;
}

export function BillingVoicePanel({
  voiceCommand,
  onVoiceCommandChange,
  voiceListening,
  voiceMicMessage,
  voiceDraft,
  onStartVoiceListening,
  onParseVoiceDraft,
  onAddVoiceDraftToCart,
}: BillingVoicePanelProps) {
  const { t } = useAppLanguage();

  return (
    <div className="rounded-2xl border bg-primary/5 p-3 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="font-semibold"><Mic className="mr-2 inline h-4 w-4" /> {t("billing.voice.title")}</div>
        <Badge variant="outline">{t("billing.voice.reviewBadge")}</Badge>
      </div>
      <div className="mt-3 grid gap-2 lg:grid-cols-[1fr_auto_auto] lg:items-start">
        <Textarea
          value={voiceCommand}
          onChange={(event) => onVoiceCommandChange(event.target.value)}
          className="min-h-20 resize-none bg-background px-3 py-2"
          placeholder="Example: Ramesh ke naam 2 kilo chini 45 rupay kilo, ek tel packet 120, 500 udhar"
        />
        <Button type="button" variant={voiceListening ? "destructive" : "outline"} className="min-h-11" onClick={onStartVoiceListening}>
          <Mic className="mr-2 h-4 w-4" />{voiceListening ? "Stop mic" : "Start mic"}
        </Button>
        <Button type="button" className="min-h-11" onClick={onParseVoiceDraft}>Parse command</Button>
      </div>
      <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${voiceListening ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground"}`}>{voiceMicMessage}</p>
      {voiceDraft && (
        <div className="mt-3 rounded-xl border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">AI draft review</div>
            <Button type="button" size="sm" onClick={onAddVoiceDraftToCart} disabled={voiceDraft.lines.length === 0}>Add parsed items to cart</Button>
          </div>
          {voiceDraft.customerName && <p className="mt-2 text-xs text-muted-foreground">Customer: {voiceDraft.customerName}</p>}
          {voiceDraft.udharAmount !== undefined && <p className="text-xs text-muted-foreground">Udhar detected: ₹{voiceDraft.udharAmount.toLocaleString("en-IN")}</p>}
          <div className="mt-2 space-y-1">
            {voiceDraft.lines.map((line) => (
              <div key={`${line.product.id}-${line.source}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <span className="font-medium">{line.product.name}</span>
                <span>{line.quantity} {line.unit} × ₹{line.rate} = ₹{(line.quantity * line.rate).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
          {voiceDraft.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-destructive">{warning}</p>)}
        </div>
      )}
    </div>
  );
}
