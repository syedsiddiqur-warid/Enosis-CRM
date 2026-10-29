"use client";

import { Info } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Dialog, DialogContent, Tooltip } from "@/components/ui/overlays";
import { viewInsights } from "@/lib/crm/insight-actions";
import type { InsightBreakdown, InsightKpi, Insights } from "@/lib/crm/insights";
import type { CrmObject, FilterCondition, ViewState } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

/** Side drawer with insights for what a contacts / companies list shows. Clicking a value filters the list. */
export function ViewInsightsDrawer({
  open,
  onOpenChange,
  object,
  systemKey,
  state,
  q,
  onDrill,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  object: CrmObject;
  systemKey: string | null;
  state: ViewState;
  q: string;
  onDrill: (c: FilterCondition) => void;
}) {
  const [result, setResult] = useState<{ data: Insights | null; error: string | null; loading: boolean }>({ data: null, error: null, loading: false });
  const key = JSON.stringify([object, systemKey, state.quick, state.advanced, q]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    setResult((r) => ({ ...r, loading: true, error: null }));
    const [o, sk, quick, advanced, query] = JSON.parse(key) as [CrmObject, string | null, ViewState["quick"], ViewState["advanced"], string];
    viewInsights(o, sk, { quick, advanced, chips: [], columns: [], sort: null }, query).then((res) => {
      if (live) setResult(res.ok ? { data: res.data, error: null, loading: false } : { data: null, error: res.error, loading: false });
    });
    return () => {
      live = false;
    };
  }, [open, key]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title="Insights for this view" className="w-[min(920px,100vw)]">
        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-4">
          <p className="mb-3 text-[12px] text-ink-muted">The records this list shows with its current view, filters and search. Click a number or a bar to filter the list to it.</p>
          <InsightsPanel insights={result.data} loading={result.loading} error={result.error} onDrill={onDrill} columns={2} />
        </div>
      </DialogContent>
    </Dialog>
  );
}

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 && a ? 1 : 0)}%` : "0%");

/** Headline numbers and breakdowns for a set of records. Bars and tiles narrow the list when clicked. */
export function InsightsPanel({
  insights,
  loading,
  error,
  drillHref,
  onDrill,
  columns = 3,
}: {
  insights: Insights | null;
  loading?: boolean;
  error?: string | null;
  /** Link that opens the list narrowed to a bar */
  drillHref?: (c: FilterCondition) => string;
  /** Or apply the condition in place */
  onDrill?: (c: FilterCondition) => void;
  columns?: 2 | 3;
}) {
  if (error) return <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>;
  if (!insights) return <p className="py-10 text-center text-[13px] text-ink-subtle">{loading ? "Working out the numbers…" : "No data"}</p>;
  const plural = insights.object === "COMPANY" ? "companies" : "contacts";
  return (
    <div className={cn("space-y-4 transition-opacity", loading && "opacity-60")}>
      <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
        {insights.kpis.map((k) => (
          <KpiTile key={k.key} kpi={k} total={insights.total} drillHref={drillHref} onDrill={onDrill} />
        ))}
      </div>
      {insights.sampled && <p className="text-[12px] text-ink-subtle">Breakdowns cover the first 50,000 {plural}.</p>}
      {insights.total === 0 ? (
        <p className="py-6 text-center text-[13px] text-ink-subtle">No {plural} to break down.</p>
      ) : (
        <div className={cn("grid gap-3", columns === 3 ? "md:grid-cols-2 xl:grid-cols-3" : "md:grid-cols-2")}>
          {insights.breakdowns.map((b) => (
            <BreakdownCard key={b.property} breakdown={b} total={Math.min(insights.total, 50_000)} drillHref={drillHref} onDrill={onDrill} />
          ))}
        </div>
      )}
    </div>
  );
}

function Drill({ condition, drillHref, onDrill, className, children, title }: { condition?: FilterCondition; drillHref?: (c: FilterCondition) => string; onDrill?: (c: FilterCondition) => void; className?: string; children: React.ReactNode; title?: string }) {
  if (condition && drillHref)
    return (
      <Link href={drillHref(condition)} className={cn(className, "hover:bg-surface-hover")} title={title}>
        {children}
      </Link>
    );
  if (condition && onDrill)
    return (
      <button type="button" onClick={() => onDrill(condition)} className={cn(className, "w-full text-left hover:bg-surface-hover")} title={title}>
        {children}
      </button>
    );
  return <div className={className}>{children}</div>;
}

function KpiTile({ kpi, total, drillHref, onDrill }: { kpi: InsightKpi; total: number; drillHref?: (c: FilterCondition) => string; onDrill?: (c: FilterCondition) => void }) {
  const value = kpi.format === "percent" ? pct(kpi.value, 1) : kpi.format === "decimal" ? kpi.value.toFixed(1) : kpi.value.toLocaleString();
  return (
    <Drill condition={kpi.key === "total" ? undefined : kpi.condition} drillHref={drillHref} onDrill={onDrill} className="block rounded-[4px] border border-line bg-surface px-3 py-2.5" title={kpi.condition ? "Show these records" : undefined}>
      <div className="flex items-center gap-1 text-[12px] text-ink-muted">
        <span className="truncate">{kpi.label}</span>
        {kpi.hint && (
          <Tooltip content={kpi.hint}>
            <Info className="size-3 shrink-0 text-ink-subtle" aria-label={kpi.hint} />
          </Tooltip>
        )}
      </div>
      <div className="mt-0.5 text-[22px] font-medium leading-tight tabular-nums">{value}</div>
      {kpi.of !== undefined && (
        <div className="text-[12px] tabular-nums text-ink-subtle">
          {pct(kpi.value, kpi.of)} of {kpi.key === "total" ? "the database" : (kpi.of === total ? total : kpi.of).toLocaleString()}
        </div>
      )}
    </Drill>
  );
}

const SHOWN = 8;

function BreakdownCard({ breakdown, total, drillHref, onDrill }: { breakdown: InsightBreakdown; total: number; drillHref?: (c: FilterCondition) => string; onDrill?: (c: FilterCondition) => void }) {
  const [all, setAll] = useState(false);
  const bars = all ? breakdown.bars : breakdown.bars.slice(0, SHOWN);
  const max = Math.max(1, ...breakdown.bars.map((b) => b.count));
  return (
    <section className="rounded-[4px] border border-line bg-surface p-3" aria-label={`${breakdown.label} breakdown`}>
      <h3 className="mb-2 flex items-baseline gap-2 text-[13px] font-semibold">
        {breakdown.label}
        <span className="text-[12px] font-normal text-ink-subtle">{breakdown.bars.length} values</span>
      </h3>
      <ul className="space-y-0.5">
        {bars.map((b) => (
          <li key={b.key}>
            <Drill
              condition={b.condition}
              drillHref={drillHref}
              onDrill={onDrill}
              className="block rounded-[3px] px-1 py-1"
              title={`${b.label}: ${b.count.toLocaleString()} (${pct(b.count, total)}). Click to see them.`}
            >
              <div className="flex items-baseline gap-2 text-[12px]">
                <span className="min-w-0 flex-1 truncate text-ink">{b.label}</span>
                <span className="shrink-0 tabular-nums text-ink-muted">
                  {b.count.toLocaleString()} <span className="text-ink-subtle">· {pct(b.count, total)}</span>
                </span>
              </div>
              <div className="mt-0.5 h-1.5 w-full rounded-full bg-surface-muted">
                <div className="h-1.5 rounded-full bg-link" style={{ width: `${Math.max(2, (b.count / max) * 100)}%` }} />
              </div>
            </Drill>
          </li>
        ))}
      </ul>
      <div className="mt-1.5 flex items-center justify-between px-1 text-[12px] text-ink-subtle">
        {breakdown.unknown > 0 ? (
          <Drill condition={{ property: breakdown.property, operator: "is_unknown" }} drillHref={drillHref} onDrill={onDrill} className="rounded-[3px] px-1 py-0.5">
            No value: {breakdown.unknown.toLocaleString()}
          </Drill>
        ) : (
          <span />
        )}
        {breakdown.bars.length > SHOWN && (
          <button type="button" className="font-medium text-link hover:underline" onClick={() => setAll((a) => !a)}>
            {all ? "Show less" : `Show all ${breakdown.bars.length}`}
          </button>
        )}
      </div>
    </section>
  );
}
