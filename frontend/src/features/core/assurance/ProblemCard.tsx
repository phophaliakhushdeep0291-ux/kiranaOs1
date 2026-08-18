// One problem, as the owner reads it.
//
// The order is the whole point: rupees first, then the arithmetic in words,
// then what to do. The rule code, the weight and the 0–100 score are still
// reachable — they are what makes the finding defensible to a CA — but they sit
// on the detail screen behind a disclosure instead of greeting the shopkeeper.
import { Link } from "wouter";
import { useAppLanguage } from "@/features/core/settings/i18n";
import type { Finding } from "./api";
import { shopMessage } from "./shop-message";
import { Chip, RiskChip, fmtDate, inrFromPaise } from "./ui";

/** The rule that earned the finding its score — the one worth leading with. */
function primaryRule(finding: Finding) {
  const active = (finding.triggeredRules ?? []).filter((rule) => rule.active);
  if (!active.length) return undefined;
  return active.reduce((top, rule) => (rule.scoreContribution > top.scoreContribution ? rule : top), active[0]);
}

export function ProblemCard({ finding, compact = false }: { finding: Finding; compact?: boolean }) {
  const { t } = useAppLanguage();
  const rule = primaryRule(finding);
  const message = shopMessage(finding, rule, t("assurance.item"));
  const others = (finding.triggeredRules ?? []).filter((r) => r.active).length - 1;

  // A rule with no shop-voice entry yet keeps the engine's own wording, so the
  // catalogue can grow one rule at a time without a blank ever rendering.
  const headline = message.rewritten ? t(message.head.key, message.head.vars) : rule?.name ?? finding.title;

  return (
    <div className="min-w-0 flex-1">
      <Link href={`/assurance/findings/${finding.findingId}`} className="block">
        <p className="text-[15px] font-semibold leading-snug hover:underline">{headline}</p>
      </Link>

      {message.body ? (
        <p className="mt-1 text-sm leading-snug text-muted-foreground">{t(message.body.key, message.body.vars)}</p>
      ) : null}

      {!compact && message.doKey ? (
        <p className="mt-1.5 text-sm leading-snug">
          <span className="font-medium">{t("assurance.whatToDo")}: </span>
          <span className="text-muted-foreground">{t(message.doKey)}</span>
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-1.5">
        <RiskChip level={finding.riskLevel} />
        {finding.occurredAt ? <Chip>{fmtDate(finding.occurredAt)}</Chip> : null}
        {others > 0 ? <Chip>+{others}</Chip> : null}
        {finding.discrepancyPaise !== null ? (
          <Chip className="font-semibold">{inrFromPaise(finding.discrepancyPaise)}</Chip>
        ) : null}
      </div>

      {/* The engine's own sentence, kept verbatim and findable — this is the
          line an accountant will want to quote back. */}
      {!compact ? (
        <p className="mt-2 text-[11px] text-muted-foreground/70">
          {t("assurance.reference")}: {finding.title}
        </p>
      ) : null}
    </div>
  );
}
