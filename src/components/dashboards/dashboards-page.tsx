"use client";

// Dashboards: the sales funnel end to end, research and handover throughput, and what callers are doing.
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useTransition } from "react";
import { Select } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { friendlyDateTime } from "@/lib/crm/dates";
import type { DashboardData } from "@/lib/crm/dashboard-loader";
import { PERIODS } from "@/lib/crm/dashboards";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "funnel", label: "Sales funnel" },
  { id: "sources", label: "Lead sources" },
  { id: "research", label: "Research" },
  { id: "handover", label: "Handover" },
  { id: "callers", label: "Callers" },
] as const;

const pct = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)}%` : "--");
const fmt = (n: number) => n.toLocaleString();
const days = (v: number | null) => (v === null ? "--" : `${v < 10 ? v.toFixed(1) : Math.round(v)} days`);

function Tile({ label, value, hint, warn }: { label: string; value: string; hint?: string; warn?: boolean }) {
  return (
    <div className="rounded-[6px] border border-line px-3 py-2.5">
      <div className={cn("text-[22px] font-medium tabular-nums", warn && "text-[#c93a41]")}>{value}</div>
      <div className="text-[12px] text-ink-muted">{label}</div>
      {hint && <div className="text-[11px] text-ink-subtle">{hint}</div>}
    </div>
  );
}

function Section({ title, help, children }: { title: string; help?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-[6px] border border-line p-4">
      <h2 className="text-[15px] font-semibold">{title}</h2>
      {help && <p className="mb-3 mt-0.5 text-[12px] text-ink-muted">{help}</p>}
      {!help && <div className="mb-3" />}
      <div className="thin-scroll overflow-x-auto">{children}</div>
    </section>
  );
}

/** Horizontal bars: label, bar scaled to the largest value, count (and an optional note). */
function Bars({ rows, color = "#00a4bd" }: { rows: { label: string; n: number; note?: string; color?: string | null }[]; color?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.n));
  if (!rows.length) return <p className="text-[13px] text-ink-subtle">Nothing in this period.</p>;
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="grid grid-cols-[minmax(110px,180px)_1fr_auto] items-center gap-2 text-[13px]">
          <span className="truncate" title={r.label}>
            {r.label}
          </span>
          <span className="h-4 overflow-hidden rounded-[3px] bg-surface-muted">
            <span className="block h-full rounded-[3px]" style={{ width: `${(r.n / max) * 100}%`, background: r.color ?? color }} />
          </span>
          <span className="min-w-[90px] text-right tabular-nums">
            {fmt(r.n)}
            {r.note && <span className="ml-1 text-[12px] text-ink-subtle">{r.note}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export function DashboardsPage({ data }: { data: DashboardData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const f = data.filters;
  const setParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };
  const period = PERIODS.find((p) => p.value === f.period)?.label.toLowerCase() ?? "";

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="px-6 pb-2 pt-4">
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="mr-auto text-[22px] font-medium">Dashboards</h1>
          <Select className="h-8 w-[160px]" value={f.period} onChange={(e) => setParams({ period: e.target.value })} aria-label="Period">
            {PERIODS.map((p) => (
              <option key={p.value} value={p.value}>
                {p.label}
              </option>
            ))}
          </Select>
          {(f.tab === "funnel" || f.tab === "sources") && (
            <Select className="h-8 w-[200px]" value={f.source} onChange={(e) => setParams({ source: e.target.value })} aria-label="Lead source">
              <option value="">All lead sources</option>
              {data.sources.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.value === "(none)" ? "No source" : s.value} ({fmt(s.count)})
                </option>
              ))}
            </Select>
          )}
          {f.tab === "callers" && (
            <Select className="h-8 w-[220px]" value={f.campaign} onChange={(e) => setParams({ campaign: e.target.value })} aria-label="Campaign">
              <option value="">All campaigns</option>
              {data.campaigns.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          )}
        </div>
        <p className="mt-1 text-[12px] text-ink-subtle">Updated {friendlyDateTime(data.generatedAt)} · numbers refresh every 5 minutes</p>
      </div>
      <div className="flex gap-1 border-b border-line px-6" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={f.tab === t.id}
            onClick={() => setParams({ tab: t.id === "funnel" ? "" : t.id })}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[14px]", f.tab === t.id ? "border-link font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink")}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="thin-scroll min-h-0 flex-1 space-y-4 overflow-y-auto px-6 py-4">
        {f.tab === "funnel" && <Funnel data={data} period={period} />}
        {f.tab === "sources" && <Sources data={data} period={period} />}
        {f.tab === "research" && <Research data={data} period={period} />}
        {f.tab === "handover" && <Handover data={data} period={period} />}
        {f.tab === "callers" && <Callers data={data} period={period} />}
      </div>
    </div>
  );
}

function Funnel({ data, period }: { data: DashboardData; period: string }) {
  const color = (s: string) => data.stages.find((x) => x.value === s)?.color ?? data.exits.find((x) => x.value === s)?.color ?? null;
  const top = data.funnel[0] ?? 0;
  const order = [...data.stages.map((s) => s.value), ...data.exits.map((s) => s.value)];
  const now = [...data.nowAt].sort((a, b) => (order.indexOf(a.stage) + 1 || 999) - (order.indexOf(b.stage) + 1 || 999));
  return (
    <>
      <Section
        title={`Funnel: companies that moved, ${period}`}
        help="Each bar counts companies that reached that stage or a later one in the period. The % is how many of the stage above made it this far."
      >
        <ul className="space-y-1.5">
          {data.stages.map((s, i) => {
            const n = data.funnel[i] ?? 0;
            const prev = i ? (data.funnel[i - 1] ?? 0) : n;
            return (
              <li key={s.value} className="grid grid-cols-[150px_1fr_150px] items-center gap-2 text-[13px]">
                <span className="truncate">{s.value}</span>
                <span className="flex h-6 justify-center overflow-hidden rounded-[3px] bg-surface-muted">
                  <span className="block h-full rounded-[3px]" style={{ width: `${top ? Math.max(2, (n / top) * 100) : 0}%`, background: s.color ?? "#00a4bd" }} />
                </span>
                <span className="tabular-nums">
                  {fmt(n)} {i > 0 && <span className="text-[12px] text-ink-subtle">· {pct(n, prev)} of {data.stages[i - 1].value}</span>}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
      <Section title="Where companies are now" help="Every company by its current lead journey stage, including those that left the journey.">
        <Bars rows={now.map((r) => ({ label: r.stage, n: r.n, color: color(r.stage) }))} />
      </Section>
    </>
  );
}

function Sources({ data, period }: { data: DashboardData; period: string }) {
  const m = data.cohort.milestones;
  const t = data.cohort.total;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={`Companies sourced, ${period}`} value={fmt(t.sourced)} />
        <Tile label="Ready to call" value={fmt(t.ready ?? 0)} hint={`${pct(t.ready ?? 0, t.sourced)} of sourced`} />
        <Tile label="Reached a meeting" value={fmt(t.meeting ?? 0)} hint={`${pct(t.meeting ?? 0, t.sourced)} of sourced`} />
        <Tile label="Became clients" value={fmt(t.client ?? 0)} hint={`${pct(t.client ?? 0, t.sourced)} of sourced`} />
      </div>
      <Section
        title={`Lead sources end to end: companies sourced ${period}`}
        help="Of the companies each source brought in during the period, how many have got this far since. This shows which lead-generation tool turns into meetings and clients."
      >
        <div className="thin-scroll overflow-x-auto">
          <table className="w-full min-w-[760px] text-[13px]">
            <thead className="whitespace-nowrap text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
              <tr>
                <th className="py-1.5 pr-3">Source</th>
                <th className="py-1.5 pr-3 text-right">Sourced</th>
                {m.map((x) => (
                  <th key={x.key} className="py-1.5 pr-3 text-right">
                    {x.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {data.cohort.bySource.map((r) => (
                <tr key={r.source} className="border-t border-line">
                  <td className="py-1.5 pr-3">{r.source === "(none)" ? <span className="text-ink-subtle">No source</span> : r.source}</td>
                  <td className="py-1.5 pr-3 text-right tabular-nums">{fmt(r.counts.sourced)}</td>
                  {m.map((x) => (
                    <td key={x.key} className="py-1.5 pr-3 text-right tabular-nums">
                      {fmt(r.counts[x.key] ?? 0)} <span className="text-[11px] text-ink-subtle">{pct(r.counts[x.key] ?? 0, r.counts.sourced)}</span>
                    </td>
                  ))}
                </tr>
              ))}
              {!data.cohort.bySource.length && (
                <tr>
                  <td colSpan={m.length + 2} className="py-6 text-center text-ink-subtle">
                    No companies were sourced in this period.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Section>
    </>
  );
}

function Research({ data, period }: { data: DashboardData; period: string }) {
  const r = data.research;
  const c = r.columns;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={`New companies in, ${period}`} value={fmt(r.intake)} />
        <Tile label={`Made ready to call, ${period}`} value={fmt(r.readied)} />
        <Tile label="Average time from intake to ready" value={days(r.avgDaysToReady)} />
        <Tile label="Waiting to be researched now" value={fmt((c.to_research ?? 0) + (c.researching ?? 0))} hint={`${fmt(c.researching ?? 0)} in progress`} />
      </div>
      <Section title="Research queue now" help="Every company by its research state, as on the Research Queue board.">
        <Bars
          rows={[
            { label: "To research", n: c.to_research ?? 0, color: "#99afc4" },
            { label: "Researching", n: c.researching ?? 0, color: "#f5c26b" },
            { label: "Researched", n: c.researched ?? 0, color: "#00a4bd" },
            { label: "Viable", n: c.viable ?? 0, color: "#6a78d1" },
            { label: "Callable (ready)", n: c.callable ?? 0, color: "#00bda5" },
            { label: "Not viable", n: c.not_viable ?? 0, color: "#f2545b" },
          ]}
        />
        <Link href="/research" className="mt-2 inline-block text-[13px] text-link hover:underline">
          Open the Research Queue
        </Link>
      </Section>
      <Section title={`Researchers, ${period}`} help="Companies each researcher finished, judged viable or not, and made ready to call.">
        <table className="w-full text-[13px]">
          <thead className="whitespace-nowrap text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="py-1.5">Researcher</th>
              <th className="py-1.5 text-right">Researched</th>
              <th className="py-1.5 text-right">Viable</th>
              <th className="py-1.5 text-right">Not viable</th>
              <th className="py-1.5 text-right">Viable rate</th>
              <th className="py-1.5 text-right">Made ready</th>
            </tr>
          </thead>
          <tbody>
            {r.researchers.map((p) => (
              <tr key={p.name} className="border-t border-line">
                <td className="py-1.5">{p.name}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(p.researched)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(p.viable)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(p.notViable)}</td>
                <td className="py-1.5 text-right tabular-nums">{pct(p.viable, p.viable + p.notViable)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(p.ready)}</td>
              </tr>
            ))}
            {!r.researchers.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ink-subtle">
                  No research finished in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
      <div className="grid gap-4 lg:grid-cols-2">
        <Section title={`Intake by source, ${period}`}>
          <Bars rows={r.intakeBySource.map((x) => ({ label: x.label === "(none)" ? "No source" : x.label, n: x.n }))} />
        </Section>
        <Section title={`Intake by batch, ${period}`}>
          <Bars rows={r.intakeByBatch.map((x) => ({ label: x.label === "(none)" ? "No batch" : x.label, n: x.n }))} color="#6a78d1" />
        </Section>
      </div>
    </>
  );
}

function Handover({ data, period }: { data: DashboardData; period: string }) {
  const h = data.handover;
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        <Tile label="Ready, waiting for sales now" value={fmt(h.pool)} />
        <Tile label="Waiting more than 7 days" value={fmt(h.wait7)} warn={h.wait7 > 0} />
        <Tile label="Waiting more than 30 days" value={fmt(h.wait30)} warn={h.wait30 > 0} />
        <Tile label={`Made ready, ${period}`} value={fmt(h.readied)} />
        <Tile label={`Sent to campaigns, ${period}`} value={fmt(h.sent)} hint={`${pct(h.sent, h.readied)} of those made ready`} />
        <Tile label="Average wait before a campaign" value={days(h.avgWait)} warn={(h.avgWait ?? 0) > 7} />
      </div>
      <p className="text-[13px]">
        <Link href="/handover" className="text-link hover:underline">
          Open Handover
        </Link>{" "}
        <span className="text-ink-muted">to send waiting companies to campaigns.</span>
      </p>
    </>
  );
}

function Callers({ data, period }: { data: DashboardData; period: string }) {
  const total = data.callers.reduce((a, c) => ({ dials: a.dials + c.dials, talks: a.talks + c.talks, meetings: a.meetings + c.meetings }), { dials: 0, talks: 0, meetings: 0 });
  const max = Math.max(1, ...data.series.map((d) => d.dials));
  return (
    <>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={`Dials, ${period}`} value={fmt(total.dials)} />
        <Tile label="Conversations" value={fmt(total.talks)} hint={`${pct(total.talks, total.dials)} of dials`} />
        <Tile label="Meetings booked" value={fmt(total.meetings)} hint={`${pct(total.meetings, total.talks)} of conversations`} />
        <Tile label="Dials per meeting" value={total.meetings ? fmt(Math.round(total.dials / total.meetings)) : "--"} />
      </div>
      <Section title={`Calls per day, last ${data.series.length} days`} help="Bar height is dials; the darker part is conversations. Days use Dhaka time.">
        <div className="flex h-[140px] items-end gap-[2px]">
          {data.series.map((d) => (
            <Tooltip key={d.day} content={`${d.day}: ${fmt(d.dials)} dials, ${fmt(d.talks)} conversations, ${fmt(d.meetings)} meetings`}>
              <span className="relative flex h-full flex-1 flex-col justify-end">
                <span className="flex w-full flex-col justify-end overflow-hidden rounded-t-[2px] bg-[#b3e6ef]" style={{ height: `${(d.dials / max) * 100}%` }}>
                  <span className="block w-full bg-[#00a4bd]" style={{ height: d.dials ? `${(d.talks / d.dials) * 100}%` : 0 }} />
                </span>
              </span>
            </Tooltip>
          ))}
        </div>
        <div className="mt-1 flex justify-between text-[11px] text-ink-subtle">
          <span>{data.series[0]?.day}</span>
          <span>{data.series.at(-1)?.day}</span>
        </div>
      </Section>
      <Section title={`Callers, ${period}`} help="Per caller: dials, real conversations, meetings booked, and average dials on the days they called.">
        <table className="w-full text-[13px]">
          <thead className="whitespace-nowrap text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="py-1.5">Caller</th>
              <th className="py-1.5 text-right">Dials</th>
              <th className="py-1.5 text-right">Per calling day</th>
              <th className="py-1.5 text-right">Conversations</th>
              <th className="py-1.5 text-right">Connect rate</th>
              <th className="py-1.5 text-right">Meetings</th>
            </tr>
          </thead>
          <tbody>
            {data.callers.map((c) => (
              <tr key={c.name} className="border-t border-line">
                <td className="py-1.5">{c.name}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(c.dials)}</td>
                <td className="py-1.5 text-right tabular-nums">{c.days ? fmt(Math.round(c.dials / c.days)) : "--"}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(c.talks)}</td>
                <td className="py-1.5 text-right tabular-nums">{pct(c.talks, c.dials)}</td>
                <td className="py-1.5 text-right tabular-nums">{fmt(c.meetings)}</td>
              </tr>
            ))}
            {!data.callers.length && (
              <tr>
                <td colSpan={6} className="py-6 text-center text-ink-subtle">
                  No calls logged in this period.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </Section>
      <Section title={`Call outcomes, ${period}`}>
        <Bars rows={data.outcomes.map((o) => ({ label: o.label, n: o.n, note: pct(o.n, total.dials) }))} />
      </Section>
    </>
  );
}
