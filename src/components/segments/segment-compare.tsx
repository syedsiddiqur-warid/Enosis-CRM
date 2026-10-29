"use client";

import Link from "next/link";
import { useState } from "react";
import { Button, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import { compareSegments, type SegmentComparison } from "@/lib/crm/insight-actions";
import type { InsightKpi } from "@/lib/crm/insights";
import type { SegmentListRow } from "@/lib/crm/segments";
import type { CrmObject } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const pct = (a: number, b: number) => (b ? `${((a / b) * 100).toFixed(a / b < 0.1 && a ? 1 : 0)}%` : "0%");
const kpiText = (k: InsightKpi | undefined) =>
  !k ? "--" : k.format === "percent" ? pct(k.value, 1) : k.format === "decimal" ? k.value.toFixed(1) : `${k.value.toLocaleString()}${k.of !== undefined && k.key !== "total" ? ` (${pct(k.value, k.of)})` : ""}`;

/** Analyze tab: pick 2–4 segments and compare their size, numbers, value mix and overlap. */
export function SegmentCompare({ rows }: { rows: SegmentListRow[] }) {
  const [object, setObject] = useState<CrmObject>(rows.some((r) => r.objectType === "COMPANY") ? "COMPANY" : "CONTACT");
  const [ids, setIds] = useState<string[]>([]);
  const [result, setResult] = useState<SegmentComparison | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [property, setProperty] = useState("");
  const options = rows.filter((r) => r.objectType === object);
  const plural = object === "COMPANY" ? "companies" : "contacts";

  async function run() {
    setLoading(true);
    setError(null);
    const res = await compareSegments(ids);
    setLoading(false);
    if (!res.ok) return setError(res.error);
    setResult(res.data);
    setProperty((p) => p || res.data.segments[0]?.insights.breakdowns[0]?.property || "");
  }

  const segs = result?.segments ?? [];
  const kpiKeys = segs[0]?.insights.kpis.map((k) => k.key) ?? [];
  const breakdownProps = segs[0]?.insights.breakdowns.map((b) => [b.property, b.label] as const) ?? [];
  // Value rows for the chosen property, across all compared segments
  const valueRows = (() => {
    const m = new Map<string, { label: string; counts: number[] }>();
    segs.forEach((s, i) => {
      for (const b of s.insights.breakdowns.find((x) => x.property === property)?.bars ?? []) {
        const row = m.get(b.key) ?? { label: b.label, counts: segs.map(() => 0) };
        row.counts[i] = b.count;
        m.set(b.key, row);
      }
    });
    return [...m.values()].sort((a, b) => b.counts.reduce((x, y) => x + y, 0) - a.counts.reduce((x, y) => x + y, 0)).slice(0, 25);
  })();

  return (
    <div className="thin-scroll min-h-0 flex-1 overflow-y-auto px-6 py-4 text-[13px]">
      <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
        <aside className="space-y-3">
          <div>
            <div className="mb-1 text-[12px] font-medium">Segments of</div>
            <div className="flex gap-2">
              {(["COMPANY", "CONTACT"] as const).map((o) => (
                <Button key={o} size="sm" variant={object === o ? "outline" : "secondary"} aria-pressed={object === o} onClick={() => (setObject(o), setIds([]), setResult(null))}>
                  {o === "COMPANY" ? "Companies" : "Contacts"}
                </Button>
              ))}
            </div>
          </div>
          <div>
            <div className="mb-1 flex justify-between text-[12px] font-medium">
              Choose 2 to 4 segments <span className="font-normal text-ink-subtle">{ids.length}/4</span>
            </div>
            <div className="thin-scroll max-h-[380px] overflow-y-auto rounded-[3px] border border-line">
              {options.map((r) => (
                <label key={r.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-surface-hover">
                  <Checkbox checked={ids.includes(r.id)} disabled={!ids.includes(r.id) && ids.length >= 4} onCheckedChange={(c) => setIds((x) => (c ? [...x, r.id] : x.filter((y) => y !== r.id)))} />
                  <span className="min-w-0 flex-1 truncate">{r.name}</span>
                  <span className="tabular-nums text-ink-subtle">{r.size.toLocaleString()}</span>
                </label>
              ))}
              {!options.length && <p className="px-3 py-2 text-ink-subtle">No {plural} segments yet.</p>}
            </div>
          </div>
          <Button variant="primary" className="w-full" disabled={ids.length < 2 || loading} onClick={run}>
            {loading ? "Comparing…" : "Compare segments"}
          </Button>
          {error && <p className="text-danger">{error}</p>}
        </aside>

        <div className="min-w-0 space-y-5">
          {!result ? (
            <div className="rounded-[4px] border border-dashed border-line px-6 py-16 text-center text-ink-muted">
              Pick segments on the left to compare their size, calling results and make-up, and see how much they overlap.
            </div>
          ) : (
            <>
              <section>
                <h2 className="mb-2 text-[15px] font-semibold">Overview</h2>
                <div className={cn("grid gap-3", segs.length > 2 ? "md:grid-cols-2 xl:grid-cols-4" : "md:grid-cols-2")}>
                  {segs.map((s) => (
                    <div key={s.id} className="rounded-[4px] border border-line p-3">
                      <Link href={`/segments/${s.id}`} className="block truncate font-medium text-link hover:underline">
                        {s.name}
                      </Link>
                      <div className="text-[12px] text-ink-subtle">
                        {s.type === "ACTIVE" ? "Active" : "Static"} · created {formatDate(s.createdAt)}
                      </div>
                      <dl className="mt-2 space-y-1">
                        {(
                          [
                            ["Size", s.size.toLocaleString()],
                            ["% of database", pct(s.size, s.insights.database)],
                            ["7-day change", s.change7d === null ? "--" : `${s.change7d > 0 ? "+" : ""}${s.change7d}`],
                            ["Only in this segment", `${s.only.toLocaleString()} (${pct(s.only, s.size)})`],
                          ] as const
                        ).map(([k, v]) => (
                          <div key={k} className="flex justify-between gap-2">
                            <dt className="text-ink-muted">{k}</dt>
                            <dd className="font-medium tabular-nums">{v}</dd>
                          </div>
                        ))}
                      </dl>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h2 className="mb-1 text-[15px] font-semibold">Overlap</h2>
                <p className="mb-2 text-[12px] text-ink-muted">{plural[0].toUpperCase() + plural.slice(1)} in both segments. The percentage is of the row&apos;s segment.</p>
                <div className="thin-scroll overflow-x-auto">
                  <table className="min-w-full border-separate border-spacing-0">
                    <thead>
                      <tr>
                        <th className="border-b border-line px-3 py-2" />
                        {segs.map((s) => (
                          <th key={s.id} className="max-w-[180px] truncate border-b border-line px-3 py-2 text-left text-[12px] font-semibold">
                            {s.name}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {segs.map((row, i) => (
                        <tr key={row.id}>
                          <th className="max-w-[200px] truncate border-b border-line px-3 py-2 text-left text-[12px] font-semibold">{row.name}</th>
                          {segs.map((col, j) => {
                            const n = result.overlap[i][j];
                            const share = row.size ? n / row.size : 0;
                            return (
                              <td key={col.id} className="border-b border-line px-1 py-1">
                                <div
                                  className={cn("rounded-[3px] px-2 py-1.5 tabular-nums", i === j ? "text-ink-subtle" : "")}
                                  // One hue, darker for more overlap; the number is always printed
                                  style={i === j ? undefined : { background: `color-mix(in srgb, var(--link) ${Math.round(share * 45)}%, transparent)` }}
                                  title={i === j ? "Segment size" : `${n.toLocaleString()} of ${row.size.toLocaleString()} in ${row.name} are also in ${col.name}`}
                                >
                                  {n.toLocaleString()} {i !== j && <span className="text-ink-muted">· {pct(n, row.size)}</span>}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>

              <section>
                <h2 className="mb-2 text-[15px] font-semibold">Key numbers</h2>
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="border-b border-line px-3 py-2" />
                      {segs.map((s) => (
                        <th key={s.id} className="max-w-[180px] truncate border-b border-line px-3 py-2 text-right text-[12px] font-semibold">
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {kpiKeys.map((key) => (
                      <tr key={key} className="hover:bg-[#f5f8fa]">
                        <td className="border-b border-line px-3 py-1.5 text-ink-muted">{segs[0].insights.kpis.find((k) => k.key === key)?.label}</td>
                        {segs.map((s) => (
                          <td key={s.id} className="border-b border-line px-3 py-1.5 text-right tabular-nums">
                            {kpiText(s.insights.kpis.find((k) => k.key === key))}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>

              <section>
                <div className="mb-2 flex items-center gap-2">
                  <h2 className="text-[15px] font-semibold">Make-up by</h2>
                  <Select value={property} onChange={(e) => setProperty(e.target.value)} className="w-auto">
                    {breakdownProps.map(([p, l]) => (
                      <option key={p} value={p}>
                        {l}
                      </option>
                    ))}
                  </Select>
                </div>
                <table className="min-w-full border-separate border-spacing-0">
                  <thead>
                    <tr>
                      <th className="border-b border-line px-3 py-2 text-left text-[12px] font-semibold">Value</th>
                      {segs.map((s) => (
                        <th key={s.id} className="max-w-[180px] truncate border-b border-line px-3 py-2 text-right text-[12px] font-semibold">
                          {s.name}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {valueRows.map((r) => (
                      <tr key={r.label} className="hover:bg-[#f5f8fa]">
                        <td className="border-b border-line px-3 py-1.5">{r.label}</td>
                        {r.counts.map((c, i) => (
                          <td key={i} className="border-b border-line px-3 py-1.5 text-right tabular-nums">
                            {c ? (
                              <>
                                {c.toLocaleString()} <span className="text-ink-subtle">· {pct(c, Math.min(segs[i].size, 50_000))}</span>
                              </>
                            ) : (
                              <span className="text-ink-subtle">--</span>
                            )}
                          </td>
                        ))}
                      </tr>
                    ))}
                    {!valueRows.length && (
                      <tr>
                        <td colSpan={segs.length + 1} className="px-3 py-3 text-ink-subtle">
                          No values recorded.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
