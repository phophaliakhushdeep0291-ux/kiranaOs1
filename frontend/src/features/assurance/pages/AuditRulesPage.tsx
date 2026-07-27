import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { listRules, updateRule } from "../api";
import { AssuranceDisclaimer, Chip, EmptyState, RiskChip, SectionCard, humanize } from "../ui";

export default function AuditRulesPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("");

  const query = useQuery({ queryKey: ["assurance", "rules"], queryFn: listRules });

  const mutation = useMutation({
    mutationFn: (input: { ruleCode: string; enabled?: boolean; weightOverride?: number | null }) =>
      updateRule(input.ruleCode, { enabled: input.enabled, weightOverride: input.weightOverride }),
    onSuccess: (result) => {
      toast({ title: `${result.ruleCode} updated`, description: `Enabled: ${result.enabled ? "yes" : "no"} · weight ${result.effectiveWeight}` });
      queryClient.invalidateQueries({ queryKey: ["assurance", "rules"] });
    },
    onError: (error: Error) => toast({ title: "Could not update rule", description: error.message, variant: "destructive" }),
  });

  const rules = query.data?.rules ?? [];
  const categories = useMemo(() => [...new Set(rules.map((rule) => rule.category))].sort(), [rules]);
  const filtered = useMemo(() => {
    const term = search.trim().toLowerCase();
    return rules.filter((rule) => {
      if (category && rule.category !== category) return false;
      if (!term) return true;
      return (
        rule.ruleCode.toLowerCase().includes(term) ||
        rule.name.toLowerCase().includes(term) ||
        rule.description.toLowerCase().includes(term)
      );
    });
  }, [rules, search, category]);

  const grouped = useMemo(() => {
    const map = new Map<string, typeof filtered>();
    for (const rule of filtered) {
      const list = map.get(rule.category) ?? [];
      list.push(rule);
      map.set(rule.category, list);
    }
    return [...map.entries()].sort(([left], [right]) => left.localeCompare(right));
  }, [filtered]);

  return (
    <div className="space-y-4 p-4">
      <header>
        <h1 className="text-xl font-semibold">Rules &amp; Thresholds</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Every check the engine runs. Turn a rule off or change its weight if it does not match how your shop works.
        </p>
      </header>

      <AssuranceDisclaimer />

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-border bg-card p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input className="h-9 w-64 pl-8" placeholder="Search rules" value={search} onChange={(event) => setSearch(event.target.value)} />
        </div>
        <select
          className="h-9 rounded-md border border-input bg-background px-2 text-sm"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
          aria-label="Filter by category"
        >
          <option value="">All categories</option>
          {categories.map((value) => <option key={value} value={value}>{humanize(value)}</option>)}
        </select>
        <span className="ml-auto text-xs text-muted-foreground">
          {rules.length} rules · rule set <span className="font-mono">{query.data?.rulesetVersion}</span>
        </span>
      </div>

      {query.isLoading ? (
        <div className="flex h-40 items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" /> Loading rules…
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState title="No rules match" />
      ) : (
        grouped.map(([groupCategory, groupRules]) => (
          <SectionCard key={groupCategory} title={humanize(groupCategory)} description={`${groupRules.length} rule(s)`}>
            <ul className="divide-y divide-border">
              {groupRules.map((rule) => (
                <li key={rule.ruleCode} className="py-3 first:pt-0 last:pb-0">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <p className="text-sm font-semibold">{rule.name}</p>
                        <RiskChip level={rule.severity} />
                        {!rule.enabled ? <Chip>Disabled</Chip> : null}
                        {rule.weightOverride !== null ? <Chip>Custom weight</Chip> : null}
                      </div>
                      <p className="font-mono text-[11px] text-muted-foreground">
                        {rule.ruleCode} · v{rule.version} · effective {rule.effectiveFrom}
                      </p>
                      <p className="mt-1 text-xs text-muted-foreground">{rule.description}</p>
                      <p className="mt-1 text-[11px]">
                        <span className="font-medium">Remediation: </span>
                        <span className="text-muted-foreground">{rule.remediation}</span>
                      </p>
                      {rule.evidenceTypes.length ? (
                        <div className="mt-1.5 flex flex-wrap gap-1">
                          {rule.evidenceTypes.map((type) => <Chip key={type}>{humanize(type)}</Chip>)}
                        </div>
                      ) : null}
                    </div>
                    <div className="flex shrink-0 items-center gap-4">
                      <div className="text-right">
                        <label className="text-[10px] uppercase tracking-wide text-muted-foreground" htmlFor={`weight-${rule.ruleCode}`}>
                          Weight
                        </label>
                        <Input
                          id={`weight-${rule.ruleCode}`}
                          type="number"
                          min={0}
                          max={60}
                          className="h-8 w-20 text-right"
                          defaultValue={rule.effectiveWeight}
                          onBlur={(event) => {
                            const next = Number(event.target.value);
                            if (!Number.isFinite(next) || next === rule.effectiveWeight) return;
                            mutation.mutate({ ruleCode: rule.ruleCode, weightOverride: next });
                          }}
                        />
                        <p className="mt-0.5 text-[10px] text-muted-foreground">default {rule.defaultWeight}</p>
                      </div>
                      <div className="text-center">
                        <label className="block text-[10px] uppercase tracking-wide text-muted-foreground" htmlFor={`enabled-${rule.ruleCode}`}>
                          On
                        </label>
                        <Switch
                          id={`enabled-${rule.ruleCode}`}
                          checked={rule.enabled}
                          onCheckedChange={(checked) => mutation.mutate({ ruleCode: rule.ruleCode, enabled: checked })}
                        />
                      </div>
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>
        ))
      )}
    </div>
  );
}
