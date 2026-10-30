"use client";

import { ChevronDown, ChevronLeft, ChevronRight, ListPlus, Pencil, PhoneCall, Plus, Rocket, Search, SlidersHorizontal, Users, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { conditionDef, conditionPrefix, describeCondition, segmentFilterDef } from "@/components/index/filter-editor";
import { pageNumbers } from "@/components/index/index-page";
import { AdvancedFiltersPanel } from "@/components/index/quick-filters";
import { CompanyLogo, Pill } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { searchCompanies } from "@/lib/crm/actions";
import {
  addCompaniesToCampaign,
  addPeopleToCampaign,
  addSegmentToCampaign,
  assignMembers,
  cloneCampaign,
  deleteCampaign,
  distributeUnassigned,
  previewCriteria,
  removeFromCampaign,
  removePeopleFromCampaign,
  restorePeopleToCampaign,
  restoreToCampaign,
  setMemberStatus,
  syncCampaignNow,
  updateCampaign,
} from "@/lib/crm/campaign-actions";
import type { CampaignData } from "@/lib/crm/campaign-loader";
import type { CampaignSettings } from "@/lib/crm/campaigns";
import { formatDate, localTime } from "@/lib/crm/dates";
import { searchContacts } from "@/lib/crm/record-actions";
import type { FilterGroup } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { Bars, CAMPAIGN_STATUS, CampaignStatusPill, OptionPill, StatTile } from "./campaign-ui";

type Toast = { message: string; undo?: () => Promise<void> };

export function CampaignDetail({ data }: { data: CampaignData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const { campaign: c, stats } = data;

  useEffect(() => {
    if (data.autoAdded) setToast({ message: `${data.autoAdded} new ${data.autoAdded === 1 ? "company matches" : "companies match"} the criteria and ${data.autoAdded === 1 ? "was" : "were"} added` });
  }, [data.autoAdded]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const setParams = (patch: Record<string, string | null>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };
  const run: Run = (fn, message, undo) =>
    startTransition(async () => {
      const res = await fn();
      if (res && !res.ok) return setToast({ message: res.error ?? "Something went wrong" });
      const text = (res && res.message) ?? message;
      if (text) setToast({ message: text, undo });
      router.refresh();
    });

  const remaining = stats.byStatus["Queued"] ?? 0;
  const connectRate = stats.calls ? Math.round((stats.connects / stats.calls) * 100) : null;

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      {pending && <div className="fixed inset-x-0 top-12 z-30 h-0.5 animate-pulse bg-link" />}
      <div className="space-y-3">
        {/* Header */}
        <section className="rounded-[6px] border border-line bg-surface px-6 pb-4 pt-3">
          <Link href="/campaigns" className="inline-flex items-center gap-1 text-[13px] text-link hover:underline">
            <ChevronLeft className="size-4" /> Campaigns
          </Link>
          <div className="mt-1 flex flex-wrap items-center gap-3">
            <h1 className="text-[22px] font-medium">{c.name}</h1>
            <CampaignStatusPill status={c.status} />
            <div className="ml-auto flex items-center gap-2">
              {c.status === "ACTIVE" && (
                <Button variant="primary" asChild>
                  <Link href={`/prospecting/${c.id}`}>
                    <PhoneCall /> Start calling
                  </Link>
                </Button>
              )}
              {data.canEdit && c.status === "DRAFT" && (
                <Button variant="primary" onClick={() => run(() => updateCampaign(c.id, { status: "ACTIVE" }), "Campaign launched: its companies are now In campaign")}>
                  <Rocket /> Launch campaign
                </Button>
              )}
              {data.canEdit && (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button variant="secondary">
                      Actions <ChevronDown />
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuLabel>Status</DropdownMenuLabel>
                    {(["ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"] as const)
                      .filter((s) => s !== c.status)
                      .map((s) => (
                        <DropdownMenuItem key={s} onSelect={() => run(() => updateCampaign(c.id, { status: s }), `Campaign is now ${CAMPAIGN_STATUS[s].label.toLowerCase()}`)}>
                          {s === "ACTIVE" ? (c.status === "DRAFT" ? "Launch" : "Resume") : s === "PAUSED" ? "Pause" : s === "COMPLETED" ? "Mark completed" : "Archive"}
                        </DropdownMenuItem>
                      ))}
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      onSelect={() =>
                        startTransition(async () => {
                          const res = await cloneCampaign(c.id);
                          if (!res.ok) return setToast({ message: res.error });
                          router.push(`/campaigns/${res.data!.id}?tab=criteria`);
                        })
                      }
                    >
                      Clone criteria and settings
                    </DropdownMenuItem>
                    <DropdownMenuItem asChild>
                      <a href={`/api/export/companies?campaign=${c.id}`}>Export companies (CSV)</a>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem
                      destructive
                      onSelect={() =>
                        startTransition(async () => {
                          const res = await deleteCampaign(c.id);
                          if (!res.ok) return setToast({ message: res.error });
                          router.push("/campaigns");
                        })
                      }
                    >
                      Delete
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              )}
            </div>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-ink-muted">
            <span>{c.type}</span>
            {c.audience === "CONTACT" && (
              <span className="inline-flex items-center gap-1 font-medium text-[#4b58b0]">
                <Users className="size-3.5" /> Contact campaign: only the chosen people are called
              </span>
            )}
            <span>Owner: {c.owner?.name ?? "--"}</span>
            <span>{c.startDate || c.endDate ? `${formatDate(c.startDate) || "…"} – ${formatDate(c.endDate) || "…"}` : "No dates set"}</span>
            {c.audience === "COMPANY" && <span>{c.criteria.length ? (c.settings.autoAdd ? "Adds new matches automatically" : "Criteria-based, manual sync") : "Hand-picked set"}</span>}
          </div>
          {c.description && <p className="mt-2 max-w-[900px] text-[13px]">{c.description}</p>}
        </section>

        {/* KPIs */}
        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
          {c.audience === "CONTACT" ? (
            <>
              <StatTile label="People" value={stats.people} hint={`at ${stats.members} ${stats.members === 1 ? "company" : "companies"}`} />
              <StatTile label="People reached" value={stats.peopleReached} hint={stats.people ? `${Math.round((stats.peopleReached / stats.people) * 100)}% of the people` : undefined} />
            </>
          ) : (
            <StatTile label="Companies" value={stats.members} goal={c.goals.companies} />
          )}
          <StatTile label="Worked" value={stats.called} hint={stats.members ? `${Math.round((stats.called / stats.members) * 100)}% of the set` : undefined} />
          <StatTile label="Calls logged" value={stats.calls} hint={c.settings.maxAttempts ? `Up to ${c.settings.maxAttempts} attempts per ${c.audience === "CONTACT" ? "person" : "company"}` : undefined} />
          <StatTile label="Connects" value={stats.connects} goal={c.goals.connects} hint={connectRate !== null ? `${connectRate}% connect rate` : undefined} />
          <StatTile label="Meetings booked" value={c.audience === "CONTACT" ? stats.peopleMeetings : stats.meetings} goal={c.goals.meetings} />
          {c.audience === "COMPANY" && <StatTile label="Not called yet" value={remaining} />}
        </section>

        <section className="grid gap-3 lg:grid-cols-3">
          <Panel title="Campaign funnel">
            <Bars
              rows={data.memberStatuses.map((o) => ({ label: o.value, count: stats.byStatus[o.value] ?? 0, color: o.color })).filter((r) => r.count)}
              empty="No companies yet"
              onPick={(s) => setParams({ status: s, tab: null, page: null })}
            />
          </Panel>
          <Panel title="Lead journey of these companies">
            <Bars rows={data.journey.map((j) => ({ label: j.stage, count: j.count, color: j.color }))} empty="No companies yet" />
          </Panel>
          <Panel title="Call outcomes">
            <Bars rows={data.outcomes.map((o) => ({ label: o.result, count: o.count, color: "#ff8f59" }))} empty="No calls logged for this campaign yet" />
          </Panel>
        </section>

        {/* Tabs */}
        <section className="rounded-[6px] border border-line bg-surface">
          <div className="flex items-end gap-1 border-b border-line px-5 pt-2">
            {(c.audience === "CONTACT"
              ? ([
                  ["people", `People (${stats.people})`],
                  ["companies", `Companies (${stats.members})`],
                  ["settings", "Pitch, goals & settings"],
                ] as const)
              : ([
                  ["companies", `Companies (${stats.members})`],
                  ["criteria", "Criteria"],
                  ["settings", "Pitch, goals & settings"],
                ] as const)
            ).map(([k, label], i) => (
              <button
                key={k}
                onClick={() => setParams({ tab: i === 0 ? null : k })}
                className={cn("-mb-px border-b-[3px] px-4 py-2.5 text-[14px]", data.tab === k ? "border-[#2d3e50] font-medium" : "border-transparent text-ink-muted hover:text-ink")}
              >
                {label}
              </button>
            ))}
          </div>
          {data.tab === "people" && <PeopleTab data={data} setParams={setParams} run={run} />}
          {data.tab === "companies" && <MembersTab data={data} setParams={setParams} run={run} />}
          {data.tab === "criteria" && <CriteriaTab data={data} run={run} />}
          {data.tab === "settings" && <SettingsTab data={data} run={run} />}
        </section>
      </div>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast.message}
          {toast.undo && (
            <button
              className="font-medium underline"
              onClick={async () => {
                await toast.undo!();
                setToast({ message: "Undone" });
                router.refresh();
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

/** Run a server action, then toast (the action's own `message` wins) and refresh. */
type Run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string } | void>, message?: string, undo?: () => Promise<void>) => void;

const addedText = (n: number) => (n ? `${n} new ${n === 1 ? "company" : "companies"} added` : "no new companies to add");

function Panel({ title, children, actions }: { title: string; children: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="rounded-[6px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex-1 text-[14px] font-semibold">{title}</h2>
        {actions}
      </div>
      <div className="px-4 py-3">{children}</div>
    </div>
  );
}

// ── Companies tab ──

function MembersTab({ data, setParams, run }: { data: CampaignData; setParams: (p: Record<string, string | null>) => void; run: Run }) {
  const c = data.campaign;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(data.q);
  const ids = [...selected];
  const allSelected = data.members.length > 0 && data.members.every((m) => selected.has(m.companyId));
  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));
  const userName = (id: string) => data.users.find((u) => u.id === id)?.name ?? "Unknown";

  useEffect(() => {
    if (q === data.q) return;
    const t = setTimeout(() => setParams({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [q, data.q, setParams]);
  useEffect(() => setSelected(new Set()), [data.members]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 px-5 pt-3">
        {[{ value: "", label: "All" }, ...data.memberStatuses].map((o) => {
          const n = o.value ? (data.stats.byStatus[o.value] ?? 0) : data.stats.members;
          if (o.value && !n && data.statusFilter !== o.value) return null;
          return (
            <button
              key={o.value || "all"}
              onClick={() => setParams({ status: o.value || null, page: null })}
              className={cn("rounded-full border px-3 py-1 text-[12px]", data.statusFilter === o.value ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            >
              {o.label} <span className="text-ink-subtle">{n}</span>
            </button>
          );
        })}
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 bg-[#e5f5f8] px-5 py-2.5 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="ghost" className="text-link">
                Set outcome <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent>
              {data.memberStatuses.map((o) => (
                <DropdownMenuItem key={o.value} onSelect={() => run(() => setMemberStatus(c.id, ids, o.value), `Marked ${ids.length} as ${o.value}`)}>
                  <span className="size-2 rounded-full" style={{ background: o.color }} /> {o.label}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          {data.canEdit && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button size="sm" variant="ghost" className="text-link">
                  Assign caller <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {data.users.map((u) => (
                  <DropdownMenuItem key={u.id} onSelect={() => run(() => assignMembers(c.id, ids, [u.id]), `Assigned ${ids.length} to ${u.name ?? u.email}`)}>
                    {u.name ?? u.email}
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onSelect={() => run(() => assignMembers(c.id, ids, []), "Unassigned")}>Unassign</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
          {data.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() => run(() => removeFromCampaign(c.id, ids), `Removed ${ids.length} from the campaign`, async () => void (await restoreToCampaign(c.id, ids)))}
            >
              Remove from campaign
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="relative w-[240px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" className="pl-8" aria-label="Search companies in campaign" />
          </div>
          <Select className="w-[180px]" value={data.ownerFilter} onChange={(e) => setParams({ owner: e.target.value || null, page: null })} aria-label="Assigned caller">
            <option value="">Any caller</option>
            <option value="__me__">Assigned to me</option>
            <option value="__none__">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </Select>
          {data.canEdit && (
            <div className="ml-auto flex items-center gap-1">
              {c.audience === "COMPANY" && (
                <AddCompanies
                  onPick={(id) =>
                    run(async () => {
                      const res = await addCompaniesToCampaign(c.id, [id]);
                      if (!res.ok) return res;
                      return { ok: true, message: res.data!.added ? "Company added" : "Already in this campaign" };
                    })
                  }
                />
              )}
              <AddSegment data={data} run={run} />
              <Distribute data={data} run={run} />
            </div>
          )}
        </div>
      )}

      <div className="thin-scroll overflow-x-auto border-t border-line">
        <table className="w-full min-w-[1150px] border-separate border-spacing-0 text-[13px]">
          <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
            <tr>
              <th className="h-10 w-10 border-b border-line px-3">
                <Checkbox
                  checked={allSelected ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(data.members.map((m) => m.companyId)))}
                  aria-label="Select all on this page"
                />
              </th>
              {["Company", "Journey stage", "Campaign outcome", "Caller", "Calls", "Last result", "Last call", "Next action", "Signals", "Local time"].map((h) => (
                <th key={h} className={cn("border-b border-line px-3 font-semibold", h === "Calls" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.members.map((m) => (
              <tr key={m.companyId} className={cn("hover:bg-[#f5f8fa]", selected.has(m.companyId) && "bg-[#f0f9fb]")}>
                <td className="border-b border-line px-3">
                  <Checkbox
                    checked={selected.has(m.companyId)}
                    onCheckedChange={(v) => {
                      const n = new Set(selected);
                      if (v) n.add(m.companyId);
                      else n.delete(m.companyId);
                      setSelected(n);
                    }}
                    aria-label={`Select ${m.name}`}
                  />
                </td>
                <td className="h-12 max-w-[240px] border-b border-line px-3">
                  <div className="flex items-center gap-2">
                    <CompanyLogo name={m.name} domain={m.domain} />
                    <div className="min-w-0">
                      <Link href={`/companies/${m.companyId}`} className="block truncate font-medium text-link hover:underline">
                        {m.name}
                      </Link>
                      <div className="truncate text-[12px] text-ink-subtle">
                        {[
                          m.industry,
                          m.employees ? `${m.employees.toLocaleString()} emp.` : null,
                          data.people ? `${data.people.perCompany[m.companyId] ?? 0} of ${m.contacts} people targeted` : `${m.contacts} contacts`,
                        ]
                          .filter(Boolean)
                          .join(" · ")}
                      </div>
                    </div>
                  </div>
                </td>
                <td className="border-b border-line px-3">
                  <OptionPill value={m.leadState} options={data.journeyOptions} />
                </td>
                <td className="border-b border-line px-3">
                  <Select
                    className="h-7 w-[150px] text-[12px]"
                    value={m.status}
                    onChange={(e) => run(() => setMemberStatus(data.campaign.id, [m.companyId], e.target.value), `${m.name}: ${e.target.value}`)}
                    aria-label={`Campaign outcome for ${m.name}`}
                  >
                    {data.memberStatuses.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                </td>
                <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">
                  {m.assignedTo ? (m.assignedTo.name ?? userName(m.assignedTo.id)) : <span className="text-ink-subtle">Unassigned</span>}
                </td>
                <td className="whitespace-nowrap border-b border-line px-3 text-right tabular-nums">
                  {m.attempts}
                  {m.connects ? <span className="text-[12px] text-[#00a38d]"> · {m.connects} conn.</span> : null}
                </td>
                <td className="whitespace-nowrap border-b border-line px-3">{m.lastResult ?? <span className="text-ink-subtle">--</span>}</td>
                <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">{m.lastCallAt ? formatDate(m.lastCallAt) : "--"}</td>
                <td className={cn("whitespace-nowrap border-b border-line px-3", m.nextActionAt && new Date(m.nextActionAt) < new Date() ? "text-danger" : "text-ink-muted")}>
                  {m.nextActionAt ? formatDate(m.nextActionAt) : "--"}
                </td>
                <td className="max-w-[180px] border-b border-line px-3">
                  <div className="flex flex-wrap gap-1">
                    {m.signalTypes.slice(0, 2).map((s) => (
                      <Pill key={s} label={s} color="#6a78d1" />
                    ))}
                    {m.signalTypes.length > 2 && <span className="text-[12px] text-ink-subtle">+{m.signalTypes.length - 2}</span>}
                  </div>
                </td>
                <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">{localTime(m.timeZone) ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!data.members.length && (
          <div className="py-14 text-center">
            <div className="mb-1 text-[16px] font-medium">{data.stats.members ? "No companies match" : "No companies in this campaign yet"}</div>
            <div className="text-[13px] text-ink-muted">
              {data.stats.members
                ? "Change the outcome, caller or search filter."
                : c.audience === "CONTACT"
                  ? "Add a contact segment, or add people from the Contacts list. Their companies appear here."
                  : "Set criteria, add a company segment, or add companies from the Companies list."}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-5 py-2.5 text-[13px]">
        <span className="text-ink-muted">{data.total} companies</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" disabled={data.page <= 1} onClick={() => setParams({ page: String(data.page - 1) })} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          {pageNumbers(data.page, pageCount).map((p, i) =>
            p === null ? (
              <span key={i} className="px-1 text-ink-subtle">
                …
              </span>
            ) : (
              <Button key={i} size="sm" variant={p === data.page ? "outline" : "ghost"} onClick={() => setParams({ page: p === 1 ? null : String(p) })}>
                {p}
              </Button>
            ),
          )}
          <Button size="icon-sm" variant="ghost" disabled={data.page >= pageCount} onClick={() => setParams({ page: String(data.page + 1) })} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── People tab (Contact campaigns) ──

function PeopleTab({ data, setParams, run }: { data: CampaignData; setParams: (p: Record<string, string | null>) => void; run: Run }) {
  const c = data.campaign;
  const p = data.people!;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState(p.q);
  const ids = [...selected];
  const allSelected = p.rows.length > 0 && p.rows.every((r) => selected.has(r.contactId));
  const pageCount = Math.max(1, Math.ceil(p.total / data.pageSize));
  const max = c.settings.maxAttempts;
  const color = (status: string) => data.memberStatuses.find((o) => o.value === status)?.color;

  useEffect(() => {
    if (q === p.q) return;
    const t = setTimeout(() => setParams({ pq: q || null, ppage: null }), 300);
    return () => clearTimeout(t);
  }, [q, p.q, setParams]);
  useEffect(() => setSelected(new Set()), [p.rows]);

  return (
    <div>
      <div className="flex flex-wrap items-center gap-1 px-5 pt-3">
        {[{ value: "", label: "All" }, ...data.memberStatuses].map((o) => {
          const n = o.value ? (p.byStatus[o.value] ?? 0) : data.stats.people;
          if (o.value && !n && p.statusFilter !== o.value) return null;
          return (
            <button
              key={o.value || "all"}
              onClick={() => setParams({ pstatus: o.value || null, ppage: null })}
              className={cn("rounded-full border px-3 py-1 text-[12px]", p.statusFilter === o.value ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            >
              {o.label} <span className="text-ink-subtle">{n}</span>
            </button>
          );
        })}
      </div>

      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 bg-[#e5f5f8] px-5 py-2.5 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
            Clear
          </Button>
          {data.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={() =>
                run(
                  async () => {
                    const res = await removePeopleFromCampaign(c.id, ids);
                    if (!res.ok) return res;
                    const gone = res.data!.companiesRemoved;
                    return { ok: true, message: `Removed ${ids.length} ${ids.length === 1 ? "person" : "people"}${gone ? `; ${gone} ${gone === 1 ? "company has" : "companies have"} nobody left and left the campaign` : ""}` };
                  },
                  undefined,
                  async () => void (await restorePeopleToCampaign(c.id, ids)),
                )
              }
            >
              Remove from campaign
            </Button>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 px-5 py-3">
          <div className="relative w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people, titles or companies" className="pl-8" aria-label="Search people in campaign" />
          </div>
          {data.canEdit && (
            <div className="ml-auto flex items-center gap-1">
              <AddPeople
                onPick={(id) =>
                  run(async () => {
                    const res = await addPeopleToCampaign(c.id, [id]);
                    if (!res.ok) return res;
                    const d = res.data!;
                    return { ok: true, message: d.added ? "Person added" : d.skipped ? "This person has no company, so they can't be called from the queue" : "Already in this campaign" };
                  })
                }
              />
              <AddSegment data={data} run={run} />
              <Distribute data={data} run={run} />
            </div>
          )}
        </div>
      )}

      <div className="thin-scroll overflow-x-auto border-t border-line">
        <table className="w-full min-w-[1000px] border-separate border-spacing-0 text-[13px]">
          <thead className="bg-surface-muted text-left text-[11px] uppercase tracking-wide">
            <tr>
              <th className="h-10 w-10 border-b border-line px-3">
                <Checkbox
                  checked={allSelected ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(p.rows.map((r) => r.contactId)))}
                  aria-label="Select all on this page"
                />
              </th>
              {["Person", "Company", "Outcome", "Calls", "Last result", "Last call", "Local time"].map((h) => (
                <th key={h} className={cn("border-b border-line px-3 font-semibold", h === "Calls" && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {p.rows.map((r) => (
              <tr key={r.contactId} className={cn("hover:bg-[#f5f8fa]", selected.has(r.contactId) && "bg-[#f0f9fb]")}>
                <td className="border-b border-line px-3">
                  <Checkbox
                    checked={selected.has(r.contactId)}
                    onCheckedChange={(v) => {
                      const n = new Set(selected);
                      if (v) n.add(r.contactId);
                      else n.delete(r.contactId);
                      setSelected(n);
                    }}
                    aria-label={`Select ${r.name}`}
                  />
                </td>
                <td className="h-12 max-w-[260px] border-b border-line px-3">
                  <Link href={`/contacts/${r.contactId}`} className="block truncate font-medium text-link hover:underline">
                    {r.name}
                  </Link>
                  <div className="truncate text-[12px] text-ink-subtle">
                    {[r.jobTitle, r.email].filter(Boolean).join(" · ") || "--"}
                    {r.doNotCall && <span className="ml-1 text-danger">· Do not call</span>}
                  </div>
                </td>
                <td className="max-w-[220px] border-b border-line px-3">
                  <div className="flex items-center gap-2">
                    <CompanyLogo name={r.company} domain={r.domain} size={20} />
                    <Link href={`/companies/${r.companyId}`} className="truncate text-link hover:underline">
                      {r.company}
                    </Link>
                  </div>
                </td>
                <td className="whitespace-nowrap border-b border-line px-3">
                  <Pill label={r.status} color={color(r.status)} />
                </td>
                <td className={cn("whitespace-nowrap border-b border-line px-3 text-right tabular-nums", max && r.attempts >= max && "font-medium text-danger")}>
                  {r.attempts}
                  {max ? <span className="text-ink-subtle"> / {max}</span> : null}
                  {r.connects ? <span className="text-[12px] text-[#00a38d]"> · {r.connects} conn.</span> : null}
                </td>
                <td className="whitespace-nowrap border-b border-line px-3">{r.lastResult ?? <span className="text-ink-subtle">--</span>}</td>
                <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">{r.lastCallAt ? formatDate(r.lastCallAt) : "--"}</td>
                <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">{localTime(r.timeZone) ?? "--"}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {!p.rows.length && (
          <div className="py-14 text-center">
            <div className="mb-1 text-[16px] font-medium">{data.stats.people ? "No people match" : "No people in this campaign yet"}</div>
            <div className="text-[13px] text-ink-muted">
              {data.stats.people ? "Change the outcome or search filter." : "Add a contact segment, add people one by one, or select people on the Contacts list and choose Add to campaign."}
            </div>
          </div>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-line px-5 py-2.5 text-[13px]">
        <span className="text-ink-muted">{p.total} people</span>
        <div className="ml-auto flex items-center gap-1">
          <Button size="icon-sm" variant="ghost" disabled={p.page <= 1} onClick={() => setParams({ ppage: String(p.page - 1) })} aria-label="Previous page">
            <ChevronLeft />
          </Button>
          {pageNumbers(p.page, pageCount).map((n, i) =>
            n === null ? (
              <span key={i} className="px-1 text-ink-subtle">
                …
              </span>
            ) : (
              <Button key={i} size="sm" variant={n === p.page ? "outline" : "ghost"} onClick={() => setParams({ ppage: n === 1 ? null : String(n) })}>
                {n}
              </Button>
            ),
          )}
          <Button size="icon-sm" variant="ghost" disabled={p.page >= pageCount} onClick={() => setParams({ ppage: String(p.page + 1) })} aria-label="Next page">
            <ChevronRight />
          </Button>
        </div>
      </div>
    </div>
  );
}

function AddPeople({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; subtitle: string | null }[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchContacts(q);
      if (live) setResults(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q]);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && setQ(""))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Add person
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people" autoFocus aria-label="Search people to add" />
        </div>
        <div className="thin-scroll max-h-[260px] overflow-y-auto pb-1">
          {results.map((r) => (
            <button
              key={r.id}
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
              onClick={() => {
                setOpen(false);
                onPick(r.id);
              }}
            >
              <div className="truncate">{r.name}</div>
              {r.subtitle && <div className="truncate text-[12px] text-ink-subtle">{r.subtitle}</div>}
            </button>
          ))}
          {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddCompanies({ onPick }: { onPick: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; domain: string | null }[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchCompanies(q);
      if (live) setResults(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q]);
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && setQ(""))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary">
          <Plus /> Add company
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search companies" autoFocus aria-label="Search companies to add" />
        </div>
        <div className="thin-scroll max-h-[260px] overflow-y-auto pb-1">
          {results.map((r) => (
            <button
              key={r.id}
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
              onClick={() => {
                setOpen(false);
                onPick(r.id);
              }}
            >
              <div className="truncate">{r.name}</div>
              {r.domain && <div className="truncate text-[12px] text-ink-subtle">{r.domain}</div>}
            </button>
          ))}
          {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function AddSegment({ data, run }: { data: CampaignData; run: Run }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const match = (s: { name: string }) => s.name.toLowerCase().includes(q.trim().toLowerCase());
  // Company campaigns: contact segments add the companies those people work at. Contact campaigns: exactly the people.
  const forPeople = data.campaign.audience === "CONTACT";
  const sections = forPeople
    ? ([["Contact segments", data.contactSegments.filter(match)]] as const)
    : ([
        ["Company segments", data.segments.filter(match)],
        ["Contact segments (adds their companies)", data.contactSegments.filter(match)],
      ] as const);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="secondary">
          <ListPlus /> Add segment
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">{forPeople ? "Add every person in a contact segment" : "Add every company in a segment"}</div>
        <div className="border-b border-line p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search segments" aria-label="Search segments" autoFocus />
        </div>
        <div className="thin-scroll max-h-[320px] overflow-y-auto py-1">
          {sections.map(([label, list]) =>
            list.length ? (
              <div key={label}>
                <div className="px-3 pb-0.5 pt-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{label}</div>
                {list.map((s) => (
                  <button
                    key={s.id}
                    className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
                    onClick={() => {
                      setOpen(false);
                      run(async () => {
                        const res = await addSegmentToCampaign(data.campaign.id, s.id);
                        if (!res.ok) return res;
                        const d = res.data!;
                        const text =
                          d.unit === "person"
                            ? `${d.added ? `${d.added} new ${d.added === 1 ? "person" : "people"} added` : "no new people to add"}${d.skipped ? `, ${d.skipped} skipped (no company)` : ""}`
                            : addedText(d.added);
                        return { ok: true, message: `${s.name}: ${text}` };
                      });
                    }}
                  >
                    {s.name}
                  </button>
                ))}
              </div>
            ) : null,
          )}
          {!sections.some(([, list]) => list.length) && <div className="px-3 py-2 text-[13px] text-ink-subtle">{q ? "No segments match" : "No segments yet"}</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function Distribute({ data, run }: { data: CampaignData; run: Run }) {
  const [open, setOpen] = useState(false);
  const [sel, setSel] = useState<Set<string>>(new Set());
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && setSel(new Set()))}>
      <Tooltip content="Spread unassigned companies evenly across callers (round robin)">
        <PopoverTrigger asChild>
          <Button size="sm" variant="secondary">
            <Users /> Distribute
          </Button>
        </PopoverTrigger>
      </Tooltip>
      <PopoverContent align="end" className="w-[260px] p-0">
        <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Distribute unassigned companies to</div>
        <div className="py-1">
          {data.users.map((u) => (
            <label key={u.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-hover">
              <Checkbox
                checked={sel.has(u.id)}
                onCheckedChange={(v) => {
                  const n = new Set(sel);
                  if (v) n.add(u.id);
                  else n.delete(u.id);
                  setSel(n);
                }}
              />
              {u.name ?? u.email}
            </label>
          ))}
        </div>
        <div className="flex justify-end border-t border-line px-3 py-2">
          <Button
            size="sm"
            variant="primary"
            disabled={!sel.size}
            onClick={() => {
              setOpen(false);
              run(() => distributeUnassigned(data.campaign.id, [...sel]), `Distributed across ${sel.size} caller${sel.size === 1 ? "" : "s"}`);
            }}
          >
            Distribute
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

// ── Criteria tab ──

const SETTING_HELP: { key: keyof CampaignSettings; label: string; help: string }[] = [
  { key: "requireCallable", label: "Only callable companies", help: "Callable = Yes after research" },
  { key: "excludeExitStages", label: "Skip exit stages", help: "Not viable, Disqualified, Do not contact, Nurture" },
  { key: "excludeOtherActive", label: "Skip companies in another active campaign", help: "Avoid two callers working the same company" },
  { key: "autoAdd", label: "Keep adding new matches while active", help: "Companies that start matching later (e.g. a new buying signal) join automatically" },
];

function CriteriaTab({ data, run }: { data: CampaignData; run: Run }) {
  const c = data.campaign;
  const [groups, setGroups] = useState<FilterGroup[]>(c.criteria);
  const [settings, setSettings] = useState<CampaignSettings>(c.settings);
  const [panelOpen, setPanelOpen] = useState(false);
  const [preview, setPreview] = useState<{ total: number; newCount: number; sample: { id: string; name: string; domain: string | null; leadState: string | null }[] } | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const segDef = segmentFilterDef(data.segments);
  const dirty = JSON.stringify(groups) !== JSON.stringify(c.criteria) || JSON.stringify(settings) !== JSON.stringify(c.settings);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const res = await previewCriteria(groups, settings, c.id);
      if (!live) return;
      if (!res.ok) return setPreviewError(res.error);
      setPreviewError(null);
      setPreview(res.data!);
    }, 300);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [groups, settings, c.id]);

  return (
    <div className="grid gap-5 px-5 py-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="space-y-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <h3 className="text-[14px] font-semibold">Which companies belong in this campaign</h3>
            {data.canEdit && (
              <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setPanelOpen(true)}>
                <SlidersHorizontal /> {groups.length ? "Edit criteria" : "Add criteria"}
              </Button>
            )}
          </div>
          <p className="mb-3 text-[12px] text-ink-muted">
            Combine your customer profile (industry, size, country, tech), buying signals, lead journey stage, contact properties, past calls and outcomes in earlier campaigns.
            Groups are alternatives (OR); conditions inside a group must all match.
          </p>
          {!groups.length && (
            <div className="rounded-[4px] border border-dashed border-line-strong px-4 py-6 text-center text-[13px] text-ink-muted">
              No criteria: this is a hand-picked set. Add criteria to build it from your data.
            </div>
          )}
          {groups.map((g, gi) => (
            <div key={gi}>
              {gi > 0 && <div className="py-1.5 text-center text-[11px] font-semibold uppercase text-ink-subtle">or</div>}
              <div className="space-y-1 rounded-[4px] border border-line bg-surface-muted p-3">
                {g.conditions.map((cond, ci) => {
                  const def = conditionDef(cond, { defs: data.defs, associatedDefs: data.associatedDefs, relatedDefs: data.relatedDefs, segDef });
                  return (
                    <div key={ci} className="text-[13px]">
                      {ci > 0 && <span className="mr-1 text-[11px] font-semibold uppercase text-ink-subtle">and</span>}
                      <span className="font-medium">
                        {conditionPrefix(cond)}
                        {def?.label ?? cond.property}
                      </span>{" "}
                      <span className="text-ink-muted">{def ? describeCondition(def, cond, data.users) : ""}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>

        <div>
          <h3 className="mb-2 text-[14px] font-semibold">Exclusions and rules</h3>
          <div className="space-y-2">
            {SETTING_HELP.map((s) => (
              <label key={s.key} className="flex cursor-pointer items-start gap-2">
                <Checkbox
                  className="mt-0.5"
                  disabled={!data.canEdit}
                  checked={!!settings[s.key]}
                  onCheckedChange={(v) => setSettings({ ...settings, [s.key]: v === true })}
                />
                <span>
                  <span className="block text-[13px]">{s.label}</span>
                  <span className="block text-[12px] text-ink-subtle">{s.help}</span>
                </span>
              </label>
            ))}
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <Checkbox
                disabled={!data.canEdit}
                checked={settings.excludeContactedDays !== null}
                onCheckedChange={(v) => setSettings({ ...settings, excludeContactedDays: v ? 30 : null })}
                aria-label="Skip recently contacted companies"
              />
              Skip companies contacted in the last
              <Input
                type="number"
                min={1}
                className="h-7 w-20"
                disabled={!data.canEdit || settings.excludeContactedDays === null}
                value={settings.excludeContactedDays ?? ""}
                onChange={(e) => setSettings({ ...settings, excludeContactedDays: e.target.value ? Math.max(1, Number(e.target.value)) : null })}
                aria-label="Days"
              />
              days
            </div>
          </div>
        </div>

        {data.canEdit && (
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <Button
              variant="primary"
              disabled={!dirty}
              onClick={() =>
                run(async () => {
                  const res = await updateCampaign(c.id, { criteria: groups, settings });
                  if (!res.ok) return res;
                  return { ok: true, message: c.status === "ACTIVE" && settings.autoAdd ? `Criteria saved, ${addedText(res.data!.added)}` : "Criteria saved" };
                })
              }
            >
              Save criteria
            </Button>
            <Button variant="ghost" disabled={!dirty} onClick={() => (setGroups(c.criteria), setSettings(c.settings))}>
              Discard changes
            </Button>
            <Tooltip content="Add every company that matches now and isn't in the campaign yet (removed companies stay out)">
              <Button
                variant="secondary"
                className="ml-auto"
                disabled={dirty || !groups.length}
                onClick={() =>
                  run(async () => {
                    const res = await syncCampaignNow(c.id);
                    if (!res.ok) return res;
                    return { ok: true, message: addedText(res.data!.added).replace(/^./, (x) => x.toUpperCase()) };
                  })
                }
              >
                <Plus /> Add matching companies now
              </Button>
            </Tooltip>
          </div>
        )}
      </div>

      <div className="h-fit rounded-[6px] border border-line">
        <div className="border-b border-line px-4 py-2.5 text-[14px] font-semibold">Preview</div>
        <div className="space-y-3 px-4 py-3 text-[13px]">
          {previewError && <p className="text-danger">{previewError}</p>}
          {!groups.length ? (
            <p className="text-ink-subtle">Add criteria to see matching companies.</p>
          ) : preview ? (
            <>
              <div className="grid grid-cols-2 gap-2 text-center">
                <div className="rounded-[4px] bg-surface-muted py-2">
                  <div className="text-[20px] font-medium tabular-nums">{preview.total}</div>
                  <div className="text-[11px] text-ink-muted">companies match</div>
                </div>
                <div className="rounded-[4px] bg-surface-muted py-2">
                  <div className="text-[20px] font-medium tabular-nums">{preview.newCount}</div>
                  <div className="text-[11px] text-ink-muted">not in the campaign yet</div>
                </div>
              </div>
              {preview.sample.length > 0 && (
                <ul className="space-y-1.5">
                  {preview.sample.map((s) => (
                    <li key={s.id} className="flex items-center gap-2">
                      <CompanyLogo name={s.name} domain={s.domain} size={18} />
                      <Link href={`/companies/${s.id}`} className="min-w-0 flex-1 truncate text-link hover:underline">
                        {s.name}
                      </Link>
                      <OptionPill value={s.leadState} options={data.journeyOptions} />
                    </li>
                  ))}
                  {preview.newCount > preview.sample.length && <li className="text-[12px] text-ink-subtle">+{preview.newCount - preview.sample.length} more</li>}
                </ul>
              )}
              {dirty && <p className="text-[12px] text-ink-subtle">Unsaved changes: the preview uses your draft.</p>}
            </>
          ) : (
            <p className="text-ink-subtle">Counting…</p>
          )}
        </div>
      </div>

      <AdvancedFiltersPanel
        object="COMPANY"
        open={panelOpen}
        onOpenChange={setPanelOpen}
        defs={data.defs}
        associatedDefs={data.associatedDefs}
        relatedDefs={data.relatedDefs}
        segments={data.segments}
        groups={data.groups}
        users={data.users}
        value={groups}
        onChange={setGroups}
        title="Campaign criteria"
        hint="Conditions inside a group must all match (AND); a company matches if any group matches (OR). Buying-signal, call and campaign conditions in one group must match the same signal, call or campaign."
      />
    </div>
  );
}

// ── Settings tab ──

function SettingsTab({ data, run }: { data: CampaignData; run: Run }) {
  const c = data.campaign;
  const [form, setForm] = useState({
    name: c.name,
    type: c.type,
    description: c.description ?? "",
    ownerId: c.owner?.id ?? "",
    startDate: c.startDate?.slice(0, 10) ?? "",
    endDate: c.endDate?.slice(0, 10) ?? "",
    pitch: c.pitch ?? "",
    companies: c.goals.companies ?? "",
    connects: c.goals.connects ?? "",
    meetings: c.goals.meetings ?? "",
    maxAttempts: c.settings.maxAttempts ?? "",
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => setForm({ ...form, [k]: e.target.value });
  const n = (v: string | number) => (v === "" ? null : Math.max(0, Number(v)));
  const disabled = !data.canEdit;

  return (
    <form
      className="grid max-w-[980px] gap-5 px-5 py-4 lg:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        run(
          () =>
            updateCampaign(c.id, {
              name: form.name,
              type: form.type,
              description: form.description,
              ownerId: form.ownerId || null,
              startDate: form.startDate || null,
              endDate: form.endDate || null,
              pitch: form.pitch,
              goals: { companies: n(form.companies), connects: n(form.connects), meetings: n(form.meetings) },
              settings: { maxAttempts: n(form.maxAttempts) },
            }),
          "Campaign saved",
        );
      }}
    >
      <fieldset disabled={disabled} className="space-y-3">
        <div>
          <Label htmlFor="cs-name">Name</Label>
          <Input id="cs-name" value={form.name} onChange={set("name")} maxLength={120} />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="cs-type">Type</Label>
            <Select id="cs-type" value={form.type} onChange={set("type")}>
              {data.types.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cs-owner">Owner</Label>
            <Select id="cs-owner" value={form.ownerId} onChange={set("ownerId")}>
              <option value="">No owner</option>
              {data.users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.name ?? u.email}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="cs-start">Start date</Label>
            <Input id="cs-start" type="date" value={form.startDate} onChange={set("startDate")} />
          </div>
          <div>
            <Label htmlFor="cs-end">End date</Label>
            <Input id="cs-end" type="date" value={form.endDate} onChange={set("endDate")} />
          </div>
        </div>
        <div>
          <Label htmlFor="cs-desc">Description</Label>
          <textarea id="cs-desc" rows={3} value={form.description} onChange={set("description")} className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-link" />
        </div>
        <div>
          <div className="mb-1 text-[12px] font-medium">Goals</div>
          <div className="grid grid-cols-4 gap-2">
            {(
              [
                ["companies", "Companies"],
                ["connects", "Connects"],
                ["meetings", "Meetings"],
                ["maxAttempts", "Attempts / company"],
              ] as const
            ).map(([k, l]) => (
              <div key={k}>
                <Label htmlFor={`cs-${k}`} className="text-[11px] text-ink-muted">
                  {l}
                </Label>
                <Input id={`cs-${k}`} type="number" min={0} value={form[k]} onChange={set(k)} />
              </div>
            ))}
          </div>
        </div>
      </fieldset>
      <fieldset disabled={disabled} className="flex flex-col gap-3">
        <div className="flex flex-1 flex-col">
          <Label htmlFor="cs-pitch">
            <Pencil className="mr-1 inline size-3.5" />
            Pitch and talking points for callers
          </Label>
          <textarea
            id="cs-pitch"
            value={form.pitch}
            onChange={set("pitch")}
            rows={12}
            placeholder="Opening line, why now (the signal), relevant Enosis projects, objections and answers…"
            className="w-full flex-1 rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] outline-none focus:border-link"
          />
          <p className="mt-1 text-[12px] text-ink-subtle">Shown on company pages and in the call logger for companies in this campaign.</p>
        </div>
        {data.canEdit && (
          <div className="flex justify-end">
            <Button type="submit" variant="primary">
              Save
            </Button>
          </div>
        )}
      </fieldset>
    </form>
  );
}
