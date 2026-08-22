import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Mic } from "lucide-react";
import { useAppLanguage } from "@/features/core/settings/i18n";
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
          placeholder={t("billing.voice.placeholder")}
        />
        <Button type="button" variant={voiceListening ? "destructive" : "outline"} className="min-h-11" onClick={onStartVoiceListening}>
          <Mic className="mr-2 h-4 w-4" />{voiceListening ? t("billing.voice.stopMic") : t("billing.voice.startMic")}
        </Button>
        <Button type="button" className="min-h-11" onClick={onParseVoiceDraft}>{t("billing.voice.parse")}</Button>
      </div>
      <p className={`mt-2 rounded-lg px-3 py-2 text-xs ${voiceListening ? "bg-primary/10 text-primary" : "bg-background text-muted-foreground"}`}>{voiceMicMessage}</p>
      {voiceDraft && (
        <div className="mt-3 rounded-xl border bg-background p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-semibold">{t("billing.voice.draftTitle")}</div>
            <Button type="button" size="sm" onClick={onAddVoiceDraftToCart} disabled={voiceDraft.lines.length === 0 && voiceDraft.newProducts.length === 0}>{t("billing.voice.addToCart")}</Button>
          </div>
          {voiceDraft.customerName && <p className="mt-2 text-xs text-muted-foreground">{t("billing.voice.customer", { name: voiceDraft.customerName })}</p>}
          {voiceDraft.udharAmount !== undefined && <p className="text-xs text-muted-foreground">{t("billing.voice.udharDetected", { amount: voiceDraft.udharAmount.toLocaleString("en-IN") })}</p>}
          <div className="mt-2 space-y-1">
            {voiceDraft.lines.map((line) => (
              <div key={`${line.product.id}-${line.source}`} className="flex flex-wrap justify-between gap-2 rounded-lg bg-muted/50 px-3 py-2 text-xs">
                <span className="font-medium">{line.product.name}</span>
                <span>{line.quantity} {line.unit} × ₹{line.rate} = ₹{(line.quantity * line.rate).toLocaleString("en-IN")}</span>
              </div>
            ))}
          </div>
          {/*
            Items the catalogue does not have yet. Shown apart from the priced lines and
            labelled as new, because confirming this writes to the shop's catalogue —
            the counter should see that it is creating something, not just billing it.
          */}
          {voiceDraft.newProducts.length > 0 && (
            <div className="mt-2 space-y-1">
              <p className="text-xs font-semibold text-amber-700">{t("billing.voice.newProductsTitle")}</p>
              {voiceDraft.newProducts.map((row) => (
                <div key={row.source} className="flex flex-wrap justify-between gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs">
                  <span className="font-medium text-amber-900">{row.name}</span>
                  <span className="text-amber-900">{row.quantity} {row.unit} × ₹{row.sellingPrice} = ₹{(row.quantity * row.sellingPrice).toLocaleString("en-IN")}</span>
                </div>
              ))}
              <p className="text-[11px] text-muted-foreground">{t("billing.voice.newProductsHint")}</p>
            </div>
          )}
          {voiceDraft.warnings.map((warning) => <p key={warning} className="mt-2 text-xs text-destructive">{warning}</p>)}
        </div>
      )}
    </div>
  );
}
