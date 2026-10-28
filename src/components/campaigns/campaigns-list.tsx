"use client";

import { MoreHorizontal, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/overlays";
import { cloneCampaign, createCampaign, updateCampaign } from "@/lib/crm/campaign-actions";
import type { CampaignListData } from "@/lib/crm/campaign-loader";
import { formatDate } from "@/lib/crm/dates";
import type { PropOption, SegmentSummary } from "@/lib/crm/types";
import { cn } from "@/lib/utils";
import { CampaignStatusPill } from "./campaign-ui";

type Row = CampaignListData["campaigns"][number];
const TABS = [
  ["live", "Active & paused"],
  ["DRAFT", "Drafts"],
  ["COMPLETED", "Completed"],
  ["all", "All"],
] as const;

function pct(a: number, b: number) {
  return b ? `${Math.round((a / b) * 100)}%` : "--";
}

export function CampaignsList({ data, segments, showArchived }: { data: CampaignListData; segments: SegmentSummary[]; showArchived: boolean }) {
  const router = useRouter();
  const [tab, setTab] = useState<(typeof TABS)[number][0]>("live");
  const [q, setQ] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [, start] = useTransition();
  const rows = data.campaigns;
  const inTab = (r: Row) => (tab === "all" ? true : tab === "live" ? r.status === "ACTIVE" || r.status === "PAUSED" : r.status === tab);
  const shown = rows.filter((r) => inTab(r) && r.name.toLowerCase().includes(q.trim().toLowerCase()));

  const live = rows.filter((r) => r.status === "ACTIVE");
  const totals = live.reduce((t, r) => ({ companies: t.companies + r.stats.members, calls: t.calls + r.stats.calls, connects: t.connects + r.stats.connects, meetings: t.meetings + r.stats.meetings }), {
    companies: 0,
    calls: 0,
    connects: 0,
    meetings: 0,
  });

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      <div className="flex items-center gap-2 px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Campaigns</h1>
        <span className="text-[13px] text-ink-subtle">{rows.length} campaigns</span>
        <Button variant="primary" className="ml-auto" onClick={() => setCreateOpen(true)}>
          <Plus /> Create campaign
        </Button>
      </div>
      <p className="px-6 pb-3 text-[13px] text-ink-muted">
        Calling campaigns are sets of companies built from your customer profile, buying signals, journey stage and past call outcomes, or picked by hand. Every call logged for a campaign updates the company&apos;s outcome and lead journey.
      </p>

      <div className="grid grid-cols-2 gap-3 px-6 pb-4 md:grid-cols-4">
        {[
          ["Companies in active campaigns", totals.companies],
          ["Calls logged", totals.calls],
          ["Connects", `${totals.connects} (${pct(totals.connects, totals.calls)})`],
          ["Meetings booked", totals.meetings],
        ].map(([l, v]) => (
          <div key={String(l)} className="rounded-[4px] border border-line px-4 py-3">
            <div className="text-[12px] text-ink-muted">{l}</div>
            <div className="text-[20px] font-medium tabular-nums">{typeof v === "number" ? v.toLocaleString() : v}</div>
          </div>
        ))}
      </div>

      <div className="flex items-end gap-1 border-b border-line px-6">
        {TABS.map(([k, label]) => (
          <button
            key={k}
            onClick={() => setTab(k)}
            className={cn(
              "flex h-10 items-center gap-1.5 rounded-t-[4px] border border-b-0 px-3 text-[13px]",
              tab === k ? "-mb-px border-line bg-surface font-medium" : "border-transparent text-ink-muted hover:bg-surface-hover",
            )}
          >
            {label} <span className="text-ink-subtle">({rows.filter((r) => (k === "all" ? true : k === "live" ? r.status === "ACTIVE" || r.status === "PAUSED" : r.status === k)).length})</span>
          </button>
        ))}
        <Link href={showArchived ? "/campaigns" : "/campaigns?archived=1"} className="mb-2 ml-auto text-[13px] text-link hover:underline">
          {showArchived ? "Hide archived" : "Show archived"}
        </Link>
      </div>

      <div className="flex items-center gap-2 px-6 py-3">
        <div className="relative w-[260px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" className="pl-8" aria-label="Search campaigns" />
        </div>
        {error && <span className="text-[13px] text-danger">{error}</span>}
      </div>

      <div className="thin-scroll min-h-0 flex-1 overflow-auto border-t border-line">
        <table className="w-full min-w-[980px] border-separate border-spacing-0 text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[11px] uppercase tracking-wide">
            <tr>
              {["Campaign", "Status", "Type", "Companies", "Progress", "Calls", "Connects", "Meetings", "Owner", "Dates", ""].map((h, i) => (
                <th key={i} className={cn("h-10 border-b border-line px-3 font-semibold", ["Companies", "Calls", "Connects", "Meetings"].includes(h) && "text-right")}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => {
              const worked = r.stats.members ? r.stats.called / r.stats.members : 0;
              return (
                <tr key={r.id} className="hover:bg-[#f5f8fa]">
                  <td className="h-12 max-w-[300px] border-b border-line px-3">
                    <Link href={`/campaigns/${r.id}`} className="block truncate font-medium text-link hover:underline">
                      {r.name}
                    </Link>
                    {r.description && <div className="truncate text-[12px] text-ink-subtle">{r.description}</div>}
                  </td>
                  <td className="border-b border-line px-3">
                    <CampaignStatusPill status={r.status} />
                  </td>
                  <td className="border-b border-line px-3 text-ink-muted">{r.type}</td>
                  <td className="border-b border-line px-3 text-right tabular-nums">
                    {r.stats.members}
                    {r.goals.companies ? <span className="text-ink-subtle"> / {r.goals.companies}</span> : null}
                  </td>
                  <td className="w-[150px] border-b border-line px-3">
                    <div className="flex items-center gap-2">
                      <div className="h-1.5 flex-1 rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-[#00a4bd]" style={{ width: `${Math.round(worked * 100)}%` }} />
                      </div>
                      <span className="w-9 text-right text-[12px] tabular-nums text-ink-muted">{Math.round(worked * 100)}%</span>
                    </div>
                  </td>
                  <td className="border-b border-line px-3 text-right tabular-nums">{r.stats.calls}</td>
                  <td className="border-b border-line px-3 text-right tabular-nums">
                    {r.stats.connects} <span className="text-[12px] text-ink-subtle">({pct(r.stats.connects, r.stats.calls)})</span>
                  </td>
                  <td className="border-b border-line px-3 text-right tabular-nums">
                    {r.stats.meetings}
                    {r.goals.meetings ? <span className="text-ink-subtle"> / {r.goals.meetings}</span> : null}
                  </td>
                  <td className="border-b border-line px-3 text-ink-muted">{r.owner?.name ?? "--"}</td>
                  <td className="whitespace-nowrap border-b border-line px-3 text-ink-muted">
                    {r.startDate || r.endDate ? `${formatDate(r.startDate) || "…"} – ${formatDate(r.endDate) || "…"}` : "--"}
                  </td>
                  <td className="w-10 border-b border-line px-2">
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={`${r.name} actions`}>
                          <MoreHorizontal />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem onSelect={() => router.push(`/campaigns/${r.id}`)}>Open</DropdownMenuItem>
                        <DropdownMenuItem
                          onSelect={() =>
                            start(async () => {
                              const res = await cloneCampaign(r.id);
                              if (!res.ok) return setError(res.error);
                              router.push(`/campaigns/${res.data!.id}?tab=criteria`);
                            })
                          }
                        >
                          Clone (criteria and settings)
                        </DropdownMenuItem>
                        {r.status !== "ARCHIVED" ? (
                          <DropdownMenuItem
                            onSelect={() =>
                              start(async () => {
                                const res = await updateCampaign(r.id, { status: "ARCHIVED" });
                                if (!res.ok) return setError(res.error);
                                router.refresh();
                              })
                            }
                          >
                            Archive
                          </DropdownMenuItem>
                        ) : (
                          <DropdownMenuItem
                            onSelect={() =>
                              start(async () => {
                                const res = await updateCampaign(r.id, { status: "COMPLETED" });
                                if (!res.ok) return setError(res.error);
                                router.refresh();
                              })
                            }
                          >
                            Unarchive
                          </DropdownMenuItem>
                        )}
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!shown.length && (
          <div className="py-16 text-center">
            <div className="mb-1 text-[16px] font-medium">{rows.length ? "No campaigns here" : "No campaigns yet"}</div>
            <div className="text-[13px] text-ink-muted">Create a campaign from criteria, a company segment, or by picking companies on the Companies list.</div>
          </div>
        )}
      </div>

      <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} types={data.types} segments={segments} />
    </div>
  );
}

export function CreateCampaignDialog({
  open,
  onOpenChange,
  types,
  segments,
  companyIds,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  types: PropOption[];
  segments: SegmentSummary[];
  /** Create from a selection on the Companies list */
  companyIds?: string[];
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [from, setFrom] = useState<"criteria" | "segment" | "empty">("criteria");
  const [segmentId, setSegmentId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const companySegments = segments.filter((s) => s.objectType === "COMPANY");

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setName("");
          setDescription("");
          setError(null);
          setType(companyIds?.length ? "Custom set" : (types[0]?.value ?? "Custom set"));
          setFrom(companyIds?.length ? "empty" : "criteria");
        }
      }}
    >
      <DialogContent title={companyIds?.length ? `Create campaign with ${companyIds.length} companies` : "Create campaign"} className="w-[560px]">
        <form
          className="space-y-4 px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              const res = await createCampaign({
                name,
                type,
                description,
                startDate: startDate || null,
                endDate: endDate || null,
                segmentId: from === "segment" ? segmentId : null,
                companyIds,
              });
              if (!res.ok) return setError(res.error);
              onOpenChange(false);
              router.push(`/campaigns/${res.data!.id}${from === "criteria" ? "?tab=criteria" : ""}`);
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <div>
            <Label htmlFor="camp-name">Campaign name</Label>
            <Input id="camp-name" value={name} onChange={(e) => setName(e.target.value)} autoFocus maxLength={120} placeholder="e.g. Q1 – Series A SaaS hiring .NET devs" />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div>
              <Label htmlFor="camp-type">Type</Label>
              <Select id="camp-type" value={type} onChange={(e) => setType(e.target.value)}>
                {types.map((t) => (
                  <option key={t.value} value={t.value}>
                    {t.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="camp-start">Start date</Label>
              <Input id="camp-start" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="camp-end">End date</Label>
              <Input id="camp-end" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="camp-desc">Description</Label>
            <textarea
              id="camp-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              className="w-full rounded-[3px] border border-line-strong bg-surface px-2.5 py-1.5 text-[13px] outline-none focus:border-link"
              placeholder="Who is in it and why now"
            />
          </div>
          {!companyIds?.length && (
            <fieldset>
              <legend className="mb-1 text-[12px] font-medium">Build the company set from</legend>
              {(
                [
                  ["criteria", "Criteria", "Customer profile, buying signals, journey stage, past calls and campaign outcomes. You set them next."],
                  ["segment", "A company segment", "Start with every company in an existing segment."],
                  ["empty", "Nothing yet", "Add companies by hand or from the Companies list."],
                ] as const
              ).map(([v, l, help]) => (
                <label key={v} className="flex cursor-pointer gap-2 py-1">
                  <input type="radio" className="mt-0.5 accent-[var(--link)]" checked={from === v} onChange={() => setFrom(v)} />
                  <span>
                    <span className="block text-[13px]">{l}</span>
                    <span className="block text-[12px] text-ink-subtle">{help}</span>
                  </span>
                </label>
              ))}
              {from === "segment" && (
                <Select className="mt-1" value={segmentId} onChange={(e) => setSegmentId(e.target.value)} aria-label="Company segment">
                  <option value="">Choose a company segment</option>
                  {companySegments.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
            </fieldset>
          )}
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !name.trim() || (from === "segment" && !segmentId)}>
              {from === "criteria" ? "Next: set criteria" : "Create campaign"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
