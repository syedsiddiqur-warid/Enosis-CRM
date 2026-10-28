"use client";

import { AlertTriangle, ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { Pill } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import type { DynamicsParsed } from "@/lib/crm/dynamics-parser";
import { cn, formatPhone } from "@/lib/utils";

export interface ReviewItem {
  row: number;
  label: string;
  parsed: DynamicsParsed;
}

type Filter = "all" | "unparsed" | "unknown" | "calls";
const PAGE = 20;

const keysOf = (p: DynamicsParsed) => [...p.targets, ...p.numbers, ...p.calls, ...p.notes].map((x) => x.key).concat(p.unparsed.length ? ["u"] : []);

function when(at: string | null) {
  if (!at) return "";
  const [d, t] = at.split("T");
  const [y, m, day] = d.split("-");
  const [h, mi] = t.split(":").map(Number);
  return `${m}/${day}/${y} ${((h + 11) % 12) + 1}:${String(mi).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** What the Dynamics parsers found in each row, with a checkbox per item. Unticked items aren't imported. */
export function DynamicsReview({
  items,
  excluded,
  onChange,
  timeZone,
  onTimeZone,
}: {
  items: ReviewItem[];
  excluded: Record<number, string[]>;
  onChange: (next: Record<number, string[]>) => void;
  timeZone: "workspace" | "company";
  onTimeZone: (tz: "workspace" | "company") => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [page, setPage] = useState(0);
  const [open, setOpen] = useState<Set<number>>(() => new Set(items.slice(0, 3).map((i) => i.row)));
  const isOff = (row: number, key: string) => excluded[row]?.includes(key) ?? false;
  const toggle = (row: number, key: string) => {
    const cur = new Set(excluded[row] ?? []);
    if (cur.has(key)) cur.delete(key);
    else cur.add(key);
    onChange({ ...excluded, [row]: [...cur] });
  };

  const totals = useMemo(() => {
    const t = { targets: 0, numbers: 0, calls: 0, unknownCalls: 0, notes: 0, unparsedRows: 0 };
    for (const i of items) {
      const on = <T extends { key: string }>(list: T[]) => list.filter((x) => !isOff(i.row, x.key));
      t.targets += on(i.parsed.targets).length;
      t.numbers += on(i.parsed.numbers).length;
      t.calls += on(i.parsed.calls).length;
      t.unknownCalls += on(i.parsed.calls).filter((c) => !c.result).length;
      t.notes += on(i.parsed.notes).length + (i.parsed.unparsed.length && !isOff(i.row, "u") ? 1 : 0);
      if (i.parsed.unparsed.length) t.unparsedRows++;
    }
    return t;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, excluded]);

  const shown = items.filter((i) =>
    filter === "unparsed" ? i.parsed.unparsed.length > 0 : filter === "unknown" ? i.parsed.calls.some((c) => !c.result) : filter === "calls" ? i.parsed.calls.length > 0 : keysOf(i.parsed).length > 0,
  );
  const pages = Math.max(1, Math.ceil(shown.length / PAGE));
  const slice = shown.slice(page * PAGE, page * PAGE + PAGE);

  return (
    <section className="rounded-[6px] border border-line">
      <div className="border-b border-line px-4 py-3">
        <h2 className="text-[15px] font-semibold">Review the Dynamics data</h2>
        <p className="mt-0.5 text-[12px] text-ink-muted">
          This is what the Description and Caller Notes parsers found. Untick anything that&apos;s wrong; it won&apos;t be imported. Text the parsers didn&apos;t understand is kept as a note on the record.
          Calls already imported (same time and number) are skipped, so re-importing the same file is safe.
        </p>
        <div className="mt-3 grid grid-cols-3 gap-2 md:grid-cols-6">
          {(
            [
              ["Targets → contacts", totals.targets],
              ["Numbers", totals.numbers],
              ["Calls", totals.calls],
              ["Calls, outcome not recognised", totals.unknownCalls],
              ["Notes", totals.notes],
              ["Rows with unparsed text", totals.unparsedRows],
            ] as const
          ).map(([l, n]) => (
            <div key={l} className="rounded-[4px] bg-surface-muted px-3 py-2">
              <div className={cn("text-[18px] font-medium tabular-nums", l.startsWith("Calls, outcome") && n > 0 && "text-[#b7791f]")}>{n.toLocaleString()}</div>
              <div className="text-[11px] text-ink-muted">{l}</div>
            </div>
          ))}
        </div>
        <fieldset className="mt-3 text-[13px]">
          <legend className="mb-1 text-[12px] font-medium">Caller Notes times were written in</legend>
          <label className="mr-4 inline-flex cursor-pointer items-center gap-1.5">
            <input type="radio" className="accent-[var(--link)]" checked={timeZone === "workspace"} onChange={() => onTimeZone("workspace")} />
            Asia/Dhaka (the callers&apos; clock)
          </label>
          <label className="inline-flex cursor-pointer items-center gap-1.5">
            <input type="radio" className="accent-[var(--link)]" checked={timeZone === "company"} onChange={() => onTimeZone("company")} />
            The company&apos;s own time zone
          </label>
        </fieldset>
      </div>

      <div className="flex flex-wrap items-center gap-1 border-b border-line px-4 py-2">
        {(
          [
            ["all", "Rows with Dynamics data"],
            ["calls", "With calls"],
            ["unknown", "Outcome not recognised"],
            ["unparsed", "Unparsed text"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            onClick={() => (setFilter(k), setPage(0))}
            className={cn("rounded-full border px-3 py-1 text-[12px]", filter === k ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
          >
            {l}
          </button>
        ))}
        <span className="ml-auto text-[12px] text-ink-subtle">{shown.length} rows</span>
      </div>

      <ul>
        {slice.map((i) => {
          const p = i.parsed;
          const expanded = open.has(i.row);
          const all = keysOf(p);
          const allOff = all.every((k) => isOff(i.row, k));
          return (
            <li key={i.row} className="border-b border-line last:border-b-0">
              <div className="flex items-center gap-2 px-4 py-2 text-[13px]">
                <button
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                  onClick={() => setOpen((s) => (s.has(i.row) ? new Set([...s].filter((r) => r !== i.row)) : new Set([...s, i.row])))}
                  aria-expanded={expanded}
                >
                  {expanded ? <ChevronDown className="size-4 shrink-0 text-ink-muted" /> : <ChevronRight className="size-4 shrink-0 text-ink-muted" />}
                  <span className="text-ink-subtle">Row {i.row}</span>
                  <span className="truncate font-medium">{i.label}</span>
                  <span className="shrink-0 text-[12px] text-ink-muted">
                    · {p.targets.length} targets · {p.numbers.length} numbers · {p.calls.length} calls{p.notes.length ? ` · ${p.notes.length} notes` : ""}
                  </span>
                  {p.unparsed.length > 0 && <AlertTriangle className="size-3.5 shrink-0 text-[#b7791f]" aria-label="Has unparsed text" />}
                </button>
                <Button size="sm" variant="ghost" onClick={() => onChange({ ...excluded, [i.row]: allOff ? [] : all })}>
                  {allOff ? "Include all" : "Skip all"}
                </Button>
              </div>
              {expanded && (
                <div className="space-y-3 bg-surface-muted px-10 pb-3 pt-1 text-[13px]">
                  {p.targets.length > 0 && (
                    <Group title="Targets → contacts">
                      {p.targets.map((t) => (
                        <Item key={t.key} on={!isOff(i.row, t.key)} onToggle={() => toggle(i.row, t.key)} raw={t.raw}>
                          <span className="font-medium">{[t.firstName, t.lastName].filter(Boolean).join(" ") || t.email}</span>
                          {t.jobTitle && <span className="text-ink-muted">, {t.jobTitle}</span>}
                          {t.email && <span className="text-ink-muted"> · {t.email}</span>}
                          {t.phone && <span className="text-ink-muted"> · {formatPhone(t.phone)}</span>}
                          {t.linkedinUrl && <span className="text-ink-muted"> · LinkedIn</span>}
                        </Item>
                      ))}
                    </Group>
                  )}
                  {p.numbers.length > 0 && (
                    <Group title="Numbers → phone numbers">
                      {p.numbers.map((n) => (
                        <Item key={n.key} on={!isOff(i.row, n.key)} onToggle={() => toggle(i.row, n.key)} raw={n.raw}>
                          <span className="font-medium">
                            {formatPhone(n.number)}
                            {n.extension ? ` x${n.extension}` : ""}
                          </span>{" "}
                          <span className="text-ink-muted">{n.type}</span>
                          {n.ivrPath && <span className="font-mono text-[12px]"> · IVR: {n.ivrPath}</span>}
                          {n.status && <span className="text-ink-muted"> · {n.status}</span>}
                          {n.contactHint && <span className="text-ink-muted"> · for {n.contactHint}</span>}
                        </Item>
                      ))}
                    </Group>
                  )}
                  {p.calls.length > 0 && (
                    <Group title="Caller Notes → calls">
                      {p.calls.map((c) => (
                        <Item key={c.key} on={!isOff(i.row, c.key)} onToggle={() => toggle(i.row, c.key)} raw={c.raw}>
                          <span className="tabular-nums text-ink-muted">{when(c.at)}</span>{" "}
                          {c.result ? <Pill label={c.result} /> : <Pill label="Outcome not recognised" color="#f5c26b" />}
                          {c.number && <span className="text-ink-muted"> {formatPhone(c.number)}</span>}
                          {c.path && <span className="text-ink-muted"> via {c.path}</span>}
                          {c.outcomeText && <span className="text-ink-muted"> · “{c.outcomeText}”</span>}
                        </Item>
                      ))}
                    </Group>
                  )}
                  {p.notes.length > 0 && (
                    <Group title="Other entries → notes">
                      {p.notes.map((n) => (
                        <Item key={n.key} on={!isOff(i.row, n.key)} onToggle={() => toggle(i.row, n.key)}>
                          {n.at && <span className="tabular-nums text-ink-muted">{when(n.at)} </span>}
                          {n.body}
                        </Item>
                      ))}
                    </Group>
                  )}
                  {p.unparsed.length > 0 && (
                    <Group title="Not understood → kept as one note">
                      <Item on={!isOff(i.row, "u")} onToggle={() => toggle(i.row, "u")}>
                        <span className="whitespace-pre-line text-[#8a5a00]">{p.unparsed.join("\n")}</span>
                      </Item>
                    </Group>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {!slice.length && <li className="px-4 py-6 text-center text-[13px] text-ink-subtle">No rows here</li>}
      </ul>
      {pages > 1 && (
        <div className="flex items-center justify-end gap-2 border-t border-line px-4 py-2 text-[13px]">
          <Button size="sm" variant="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
            Previous
          </Button>
          <span className="text-ink-muted">
            Page {page + 1} of {pages}
          </span>
          <Button size="sm" variant="ghost" disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>
            Next
          </Button>
        </div>
      )}
    </section>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{title}</div>
      <ul className="space-y-1">{children}</ul>
    </div>
  );
}

function Item({ on, onToggle, raw, children }: { on: boolean; onToggle: () => void; raw?: string; children: React.ReactNode }) {
  return (
    <li>
      <label className={cn("flex cursor-pointer items-start gap-2", !on && "opacity-50 [&_span]:line-through")}>
        <input type="checkbox" className="mt-0.5 accent-[var(--link)]" checked={on} onChange={onToggle} />
        <span className="min-w-0 flex-1">
          {children}
          {raw && <span className="mt-0.5 block font-mono text-[11px] text-ink-subtle no-underline">{raw}</span>}
        </span>
      </label>
    </li>
  );
}
