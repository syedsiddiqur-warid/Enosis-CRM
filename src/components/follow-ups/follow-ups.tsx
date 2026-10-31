"use client";

// Follow-ups: called companies ranked by what callers learned. Who to chase, who to nurture, and good leads nobody is following up.
import { AlertTriangle, Search, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { AddToCampaignButton } from "@/components/campaigns/add-to-campaign";
import { CompanyLogo, Pill } from "@/components/index/values";
import { FollowBadge } from "@/components/prospecting/calling-queue";
import { Pager } from "@/components/research/research-list";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { formatDate, localTime } from "@/lib/crm/dates";
import { FOLLOW_GROUP_INFO, FOLLOW_GROUPS, type FollowGroup } from "@/lib/crm/follow-up";
import { setRevisitDate } from "@/lib/crm/follow-up-actions";
import { FOLLOW_PAGE, FORGOTTEN_DAYS, type FollowData } from "@/lib/crm/follow-up-loader";
import type { PropOption, SegmentSummary } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

export function FollowUps({ data, segments, campaignTypes }: { data: FollowData; segments: SegmentSummary[]; campaignTypes: PropOption[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(data.filters.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [message, setMessage] = useState<string | null>(null);
  const [revisit, setRevisit] = useState("");
  const ids = [...selected];
  const allOnPage = data.rows.length > 0 && data.rows.every((r) => selected.has(r.id));

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
  useEffect(() => setSelected(new Set()), [data.rows]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const revisitAll = (at: string | null, done: string) =>
    start(async () => {
      const res = await setRevisitDate(ids, at);
      setMessage(res.ok ? done : res.error);
      if (res.ok) router.refresh();
    });

  const chips = [
    { value: "", label: "All followed", count: data.counts.all, color: undefined as string | undefined },
    ...FOLLOW_GROUPS.map((g) => ({ value: g as string, label: g as string, count: data.counts[g] ?? 0, color: FOLLOW_GROUP_INFO[g].color })),
  ];

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Follow-ups</h1>
        <p className="mt-1 max-w-[860px] text-[13px] text-ink-muted">
          Every company your team has called, ranked by what callers heard on the phone. <strong>Chase now</strong> first, <strong>Nurture</strong> until their revisit date,{" "}
          <strong>Keep trying</strong> the ones nobody has reached, and stop spending time on <strong>Drop</strong>. Scores update every time a call is logged.
        </p>
      </div>

      {data.counts.forgotten > 0 && (
        <button
          onClick={() => setParams({ group: data.filters.group === "forgotten" ? "" : "forgotten", page: "" })}
          className={cn(
            "mx-6 mb-2 flex items-center gap-2 rounded-[6px] border px-3 py-2 text-left text-[13px]",
            data.filters.group === "forgotten" ? "border-[#f2545b] bg-[#fde8e9]" : "border-[#f5c26b] bg-[#fef8ec] hover:bg-[#fdf1d8]",
          )}
        >
          <AlertTriangle className="size-4 shrink-0 text-[#c93a41]" />
          <span>
            <strong>
              {data.counts.forgotten.toLocaleString()} good {data.counts.forgotten === 1 ? "lead is" : "leads are"} being forgotten
            </strong>
            : hot or warm, no call in {FORGOTTEN_DAYS} days and nothing scheduled. {data.filters.group === "forgotten" ? "Showing them below." : "Click to see them."}
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 pb-2.5">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={() => setParams({ group: c.value, page: "" })}
            className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]", data.filters.group === c.value ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            title={c.value ? FOLLOW_GROUP_INFO[c.value as FollowGroup].help : undefined}
          >
            {c.color && <span className="size-2 rounded-full" style={{ background: c.color }} />}
            {c.label} {c.count.toLocaleString()}
          </button>
        ))}
        <div className="relative ml-2 w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="h-8 pl-8" aria-label="Search companies" />
        </div>
        <Select className="h-8 w-[180px]" value={data.filters.caller} onChange={(e) => setParams({ caller: e.target.value, page: "" })} aria-label="Caller">
          <option value="">Any caller</option>
          <option value="__me__">My conversations</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        {message && <span className="text-[13px] text-ink-muted">{message}</span>}
        <div className="ml-auto">
          <Pager page={data.page} total={data.total} size={FOLLOW_PAGE} onPage={(p) => setParams({ page: String(p) })} />
        </div>
      </div>

      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            <X className="size-3.5" /> Clear
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          <AddToCampaignButton
            ids={ids}
            types={campaignTypes}
            segments={segments}
            onDone={(m, campaignId, addedIds) => {
              setMessage(m);
              setSelected(new Set());
              if (addedIds.length && campaignId) router.refresh();
            }}
          />
          <span className="mx-1 h-5 w-px bg-line" />
          <span className="text-ink-muted">Ask again on</span>
          <Input type="date" value={revisit} min={new Date().toISOString().slice(0, 10)} onChange={(e) => setRevisit(e.target.value)} className="h-8 w-[150px]" aria-label="Revisit date" />
          <Button
            size="sm"
            variant="secondary"
            disabled={!revisit || pending}
            onClick={() => revisitAll(new Date(`${revisit}T09:00:00`).toISOString(), `${ids.length} ${ids.length === 1 ? "company comes" : "companies come"} back on ${formatDate(revisit)}`)}
          >
            Set revisit date
          </Button>
          <Button size="sm" variant="ghost" disabled={pending} onClick={() => revisitAll(null, "Revisit dates cleared")}>
            Clear revisit
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
                  onCheckedChange={() => setSelected(allOnPage ? new Set() : new Set(data.rows.map((r) => r.id)))}
                  aria-label="Select this page"
                />
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Follow-up</th>
              <th className="px-3 py-2">What callers heard</th>
              <th className="px-3 py-2">Last call</th>
              <th className="px-3 py-2">Next step</th>
              <th className="px-3 py-2">Campaigns</th>
              <th className="px-3 py-2">Local time</th>
            </tr>
          </thead>
          <tbody>
            {data.rows.map((r) => {
              const overdue = !!r.next?.at && new Date(r.next.at) < new Date();
              return (
                <tr key={r.id} className={cn("border-b border-line align-top hover:bg-surface-hover", selected.has(r.id) && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(r.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(selected);
                        if (v) n.add(r.id);
                        else n.delete(r.id);
                        setSelected(n);
                      }}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="max-w-[240px] px-3 py-2">
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={r.name} domain={r.domain} size={20} />
                      <div className="min-w-0">
                        <Link href={`/companies/${r.id}`} className="block truncate font-medium text-link hover:underline">
                          {r.name}
                        </Link>
                        <div className="truncate text-[12px] text-ink-subtle">{[r.industry, r.employees ? `${r.employees.toLocaleString()} emp.` : null, r.country].filter(Boolean).join(" · ")}</div>
                      </div>
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <FollowBadge group={r.followGroup} score={r.followScore} />
                  </td>
                  <td className="max-w-[340px] px-3 py-2 text-ink-muted">{r.followReason ?? "--"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{r.lastCallAt ? formatDate(r.lastCallAt) : "--"}</div>
                    <div className="text-[12px] text-ink-subtle">
                      {r.caller ?? ""}
                      {r.crtCount ? ` · ${r.crtCount} calls` : ""}
                    </div>
                  </td>
                  <td className={cn("px-3 py-2", overdue && "text-danger")}>
                    {r.next ? (
                      <>
                        <div className="max-w-[200px] truncate">{r.next.label}</div>
                        <div className="text-[12px]">{r.next.at ? `${overdue ? "Overdue · " : ""}${formatDate(r.next.at)}` : ""}</div>
                      </>
                    ) : (
                      <span className={r.followGroup === "Chase now" ? "font-medium text-danger" : "text-ink-subtle"}>Nothing scheduled</span>
                    )}
                  </td>
                  <td className="max-w-[200px] px-3 py-2">
                    <div className="flex flex-wrap gap-1">
                      {r.campaigns.slice(0, 2).map((c) => (
                        <Link key={c.id} href={`/campaigns/${c.id}`} className="hover:underline">
                          <Pill label={c.name} />
                        </Link>
                      ))}
                      {!r.campaigns.length && <span className="text-[12px] text-ink-subtle">Not in a campaign</span>}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{localTime(r.timeZone) ?? "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!data.rows.length && (
          <div className="py-16 text-center">
            <div className="mb-1 text-[16px] font-medium">{data.counts.all ? "No companies match" : "No called companies yet"}</div>
            <div className="text-[13px] text-ink-muted">
              {data.counts.all ? "Try another group, caller or search." : "Companies appear here once calls are logged. Feedback after real conversations makes the ranking sharper."}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
