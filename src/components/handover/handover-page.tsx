"use client";

// Handover: researched, ready-to-call companies waiting for sales. Slice them into segments and campaigns, longest waiting first.
import { AlertTriangle, ListPlus, Megaphone, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CompanyLogo, LocalTime, Pill } from "@/components/index/values";
import { FollowBadge } from "@/components/prospecting/calling-queue";
import { Pager } from "@/components/research/research-list";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import { HANDOVER_PAGE, STALE_DAYS, daysWaiting } from "@/lib/crm/handover";
import { handoverIdsMatching } from "@/lib/crm/handover-actions";
import type { HandoverData } from "@/lib/crm/handover-loader";
import { createSegment } from "@/lib/crm/segment-actions";
import type { PropOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { SendToCampaignDialog } from "./send-to-campaign";

export function HandoverPage({ data, campaignTypes }: { data: HandoverData; campaignTypes: PropOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(data.filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Every company matching the filters, not just the ticked rows */
  const [allMatching, setAllMatching] = useState<string[] | null>(null);
  const [sending, setSending] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const ids = allMatching ?? [...selected];
  const allOnPage = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));
  const f = data.filters;
  const filtered = Object.entries(f).some(([k, v]) => k !== "q" && v);

  const setParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    start(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };
  useEffect(() => {
    if (q === data.filters.q) return;
    const t = setTimeout(() => setParams({ q, page: "" }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    setSelected(new Set());
    setAllMatching(null);
  }, [data.rows]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 7000);
    return () => clearTimeout(t);
  }, [message]);

  const clear = () => {
    setSelected(new Set());
    setAllMatching(null);
  };

  function selectAllMatching() {
    start(async () => {
      const res = await handoverIdsMatching(Object.fromEntries(sp.entries()));
      if (!res.ok) return setMessage(res.error);
      setAllMatching(res.data!.ids);
      if (res.data!.capped) setMessage(`Selected the first ${res.data!.ids.length.toLocaleString()} (longest waiting). Narrow the filters for the rest.`);
    });
  }

  function saveSegment() {
    const name = window.prompt("Name the segment", [f.industry, f.country, "ready to call", new Date().toISOString().slice(0, 10)].filter(Boolean).join(" – "));
    if (!name?.trim()) return;
    start(async () => {
      const res = await createSegment("COMPANY", name.trim(), "STATIC", [], ids);
      setMessage(res.ok ? `Segment "${name.trim()}" saved with ${ids.length.toLocaleString()} companies` : res.error);
      if (res.ok) clear();
    });
  }

  const facetSelect = (key: keyof typeof f, label: string, options: { value: string; count: number }[], format: (v: string) => string = (v) => v) => (
    <Select className="h-8 w-[170px]" value={f[key]} onChange={(e) => setParams({ [key]: e.target.value, page: "" })} aria-label={label}>
      <option value="">{label}: any</option>
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.value === "(none)" ? `No ${label.toLowerCase()}` : format(o.value)} ({o.count.toLocaleString()})
        </option>
      ))}
    </Select>
  );

  const tiles = [
    { label: "Ready to call, waiting for sales", value: data.counts.total, onClick: () => setParams({ wait: "", page: "" }), active: !f.wait },
    { label: `Waiting more than ${STALE_DAYS} days`, value: data.counts.stale, onClick: () => setParams({ wait: String(STALE_DAYS), page: "" }), active: f.wait === String(STALE_DAYS), warn: data.counts.stale > 0 },
    { label: "Waiting more than 30 days", value: data.counts.old, onClick: () => setParams({ wait: "30", page: "" }), active: f.wait === "30", warn: data.counts.old > 0 },
    { label: "Sent to campaigns in the last 7 days", value: data.counts.sentWeek },
  ];

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      {sending && (
        <SendToCampaignDialog
          ids={ids}
          users={data.users}
          types={campaignTypes}
          onClose={() => setSending(false)}
          onDone={(m) => {
            setSending(false);
            setMessage(m);
            clear();
            router.refresh();
          }}
        />
      )}
      <div className="px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Handover</h1>
        <p className="mt-1 max-w-[900px] text-[13px] text-ink-muted">
          Companies research has marked <strong>ready to call</strong> that aren&apos;t in a campaign yet. Filter them into a segment, then <strong>send them to a campaign</strong> and
          give them to callers. Longest waiting comes first, so research&apos;s work doesn&apos;t go stale.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-2 px-6 pb-3 lg:grid-cols-4">
        {tiles.map((t) => (
          <button
            key={t.label}
            onClick={t.onClick}
            disabled={!t.onClick}
            className={cn(
              "rounded-[6px] border px-3 py-2 text-left disabled:cursor-default",
              t.active ? "border-link bg-[#e5f5f8]" : "border-line",
              t.onClick && !t.active && "hover:bg-surface-hover",
            )}
          >
            <div className={cn("flex items-center gap-1.5 text-[22px] font-medium tabular-nums", t.warn && "text-[#c93a41]")}>
              {t.warn && <AlertTriangle className="size-4" />}
              {t.value.toLocaleString()}
            </div>
            <div className="text-[12px] text-ink-muted">{t.label}</div>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 pb-2.5">
        <div className="relative w-[200px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="h-8 pl-8" aria-label="Search companies" />
        </div>
        {facetSelect("industry", "Industry", data.facets.industries)}
        {facetSelect("country", "Country", data.facets.countries)}
        {facetSelect("tz", "Time zone", data.facets.zones, (v) => v.split("/").pop()!.replace(/_/g, " "))}
        {facetSelect("source", "Source", data.facets.sources)}
        {facetSelect("batch", "Batch", data.facets.batches)}
        <Select className="h-8 w-[170px]" value={f.researcher} onChange={(e) => setParams({ researcher: e.target.value, page: "" })} aria-label="Researcher">
          <option value="">Researcher: any</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        {filtered && (
          <Button size="sm" variant="ghost" onClick={() => setParams({ industry: "", country: "", tz: "", source: "", batch: "", researcher: "", wait: "", page: "" })}>
            <X /> Clear filters
          </Button>
        )}
        {message && <span className="text-[13px] text-ink-muted">{message}</span>}
        <div className="ml-auto">
          <Pager page={data.page} total={data.counts.matching} size={HANDOVER_PAGE} onPage={(p) => setParams({ page: String(p) })} />
        </div>
      </div>

      {(selected.size > 0 || allMatching) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          <span className="font-medium">{ids.length.toLocaleString()} selected</span>
          {!allMatching && allOnPage && data.counts.matching > data.rows.length && (
            <button className="text-link hover:underline" onClick={selectAllMatching}>
              Select all {data.counts.matching.toLocaleString()} matching
            </button>
          )}
          <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={clear}>
            <X className="size-3.5" /> Clear
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          <Button size="sm" variant="primary" onClick={() => setSending(true)}>
            <Megaphone /> Send to campaign
          </Button>
          <Button size="sm" variant="ghost" className="text-link" onClick={saveSegment}>
            <ListPlus /> Save as segment
          </Button>
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allOnPage ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={() => (setAllMatching(null), setSelected(allOnPage ? new Set() : new Set(data.rows.map((r) => r.id))))}
                  aria-label="Select this page"
                />
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Location</th>
              <th className="px-3 py-2">Targets / numbers</th>
              <th className="px-3 py-2">Source · batch</th>
              <th className="px-3 py-2">Researcher</th>
              <th className="px-3 py-2">Waiting</th>
              <th className="px-3 py-2">History</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const days = daysWaiting(r.readyAt);
              const on = !!allMatching || selected.has(r.id);
              return (
                <tr key={r.id} className={cn("border-b border-line align-top hover:bg-surface-hover", on && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={on}
                      onCheckedChange={(v) => {
                        const n = new Set(allMatching ? data.rows.map((x) => x.id) : selected);
                        if (v) n.add(r.id);
                        else n.delete(r.id);
                        setAllMatching(null);
                        setSelected(n);
                      }}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={r.name} domain={r.domain} size={20} />
                      <div className="min-w-0">
                        <Link href={`/companies/${r.id}`} className="block truncate font-medium text-link hover:underline">
                          {r.name}
                        </Link>
                        <div className="truncate text-[12px] text-ink-subtle">{[r.industry, r.employees ? `${r.employees.toLocaleString()} emp.` : null].filter(Boolean).join(" · ") || "--"}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    <div>{[r.state, r.country].filter(Boolean).join(", ") || "--"}</div>
                    <div className="text-[12px] text-ink-subtle">{r.timeZone ? <LocalTime tz={r.timeZone} suffix="local" /> : "No time zone"}</div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">
                    {r.contacts} {r.contacts === 1 ? "person" : "people"} · {r.phones} {r.phones === 1 ? "number" : "numbers"}
                  </td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.source && <Pill label={r.source} />}
                      {r.batchNumber && <Pill label={r.batchNumber} />}
                      {!r.source && !r.batchNumber && <span className="text-ink-subtle">--</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{r.researcher ?? "--"}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2", days > 30 ? "font-medium text-danger" : days > STALE_DAYS && "text-[#b07a1b]")}>
                    <div>
                      {days} {days === 1 ? "day" : "days"}
                    </div>
                    <div className="text-[12px] text-ink-subtle">since {formatDate(r.readyAt)}</div>
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    {r.lastCampaign ? (
                      <div className="text-[12px] text-ink-muted">
                        Was in{" "}
                        <Link href={`/campaigns/${r.lastCampaign.id}`} className="text-link hover:underline">
                          {r.lastCampaign.name}
                        </Link>{" "}
                        ({r.lastCampaign.status})
                      </div>
                    ) : (
                      <span className="text-[12px] text-ink-subtle">New to sales</span>
                    )}
                    {r.followGroup && (
                      <div className="mt-0.5">
                        <FollowBadge group={r.followGroup} score={r.followScore} />
                      </div>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && (
          <div className="py-16 text-center">
            <div className="mb-1 text-[16px] font-medium">{data.counts.total ? "No companies match" : "Nothing waiting for sales"}</div>
            <div className="text-[13px] text-ink-muted">
              {data.counts.total ? (
                "Try other filters."
              ) : (
                <>
                  Companies appear here when research marks them <strong>Callable</strong> on the{" "}
                  <Link href="/research" className="text-link hover:underline">
                    Research Queue
                  </Link>{" "}
                  and they pass the ready-to-call checklist.
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
