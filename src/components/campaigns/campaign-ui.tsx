"use client";

import { Pill } from "@/components/index/values";
import type { PropOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export const CAMPAIGN_STATUS: Record<string, { label: string; color: string }> = {
  DRAFT: { label: "Draft", color: "#cbd6e2" },
  ACTIVE: { label: "Active", color: "#00bda5" },
  PAUSED: { label: "Paused", color: "#f5c26b" },
  COMPLETED: { label: "Completed", color: "#6a78d1" },
  ARCHIVED: { label: "Archived", color: "#7c98b6" },
};

export function CampaignStatusPill({ status }: { status: string }) {
  const s = CAMPAIGN_STATUS[status] ?? { label: status, color: "#cbd6e2" };
  return <Pill label={s.label} color={s.color} />;
}

export function OptionPill({ value, options }: { value: string | null | undefined; options: PropOption[] }) {
  if (!value) return <span className="text-ink-subtle">--</span>;
  return <Pill label={value} color={options.find((o) => o.value === value)?.color} />;
}

/** KPI tile with an optional goal bar. */
export function StatTile({ label, value, goal, hint }: { label: string; value: number | string; goal?: number | null; hint?: string }) {
  const n = typeof value === "number" ? value : null;
  const pct = goal && n !== null ? Math.min(100, Math.round((n / goal) * 100)) : null;
  return (
    <div className="min-w-0 rounded-[4px] border border-line bg-surface px-4 py-3">
      <div className="truncate text-[12px] text-ink-muted">{label}</div>
      <div className="mt-0.5 flex items-baseline gap-1.5">
        <span className="text-[22px] font-medium tabular-nums">{typeof value === "number" ? value.toLocaleString() : value}</span>
        {goal ? <span className="text-[12px] text-ink-subtle">/ {goal} goal</span> : null}
      </div>
      {pct !== null && (
        <div className="mt-1.5 h-1.5 rounded-full bg-surface-muted">
          <div className={cn("h-full rounded-full", pct >= 100 ? "bg-[#00bda5]" : "bg-[#00a4bd]")} style={{ width: `${pct}%` }} />
        </div>
      )}
      {hint && <div className="mt-1 text-[11px] text-ink-subtle">{hint}</div>}
    </div>
  );
}

/** Horizontal bars, one per row: label, bar scaled to the largest value, count. */
export function Bars({ rows, empty, onPick }: { rows: { label: string; count: number; color?: string }[]; empty: string; onPick?: (label: string) => void }) {
  const max = Math.max(1, ...rows.map((r) => r.count));
  if (!rows.length) return <p className="text-[13px] text-ink-subtle">{empty}</p>;
  return (
    <div className="space-y-1.5">
      {rows.map((r) => (
        <button
          key={r.label}
          type="button"
          disabled={!onPick}
          onClick={() => onPick?.(r.label)}
          className={cn("flex w-full items-center gap-2 text-left text-[12px]", onPick && "rounded hover:bg-surface-hover")}
        >
          <span className="w-[140px] shrink-0 truncate">{r.label}</span>
          <span className="flex-1">
            <span className="block h-2.5 min-w-[4px] rounded-full" style={{ width: `${(r.count / max) * 100}%`, background: r.color ?? "#00a4bd" }} />
          </span>
          <span className="w-8 shrink-0 text-right tabular-nums text-ink-muted">{r.count}</span>
        </button>
      ))}
    </div>
  );
}
