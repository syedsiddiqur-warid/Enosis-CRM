"use client";

// Leads: people being worked toward a sales conversation, as a board by stage or a list.
// New → Attempting → Connected move with calls; Qualified and Disqualified are people's decisions (disqualifying needs a reason).
import { AlertTriangle, Columns3, History, List, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { ReasonDialog } from "./reason-dialog";
import { LocalTime, Pill, UserAvatar } from "@/components/index/values";
import { Pager } from "@/components/research/research-list";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Checkbox, Dialog, DialogContent } from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import { FEEDBACK_RATINGS } from "@/lib/crm/follow-up";
import { createLeads, createLeadsFromCalls, deleteLeads, moveLeads, restoreLeads, updateLeads } from "@/lib/crm/lead-actions";
import { LEAD_PAGE, STALE_DAYS, type LeadRow, type LeadsData } from "@/lib/crm/lead-loader";
import { DISQUALIFY_REASONS, LEAD_SOURCES, LEAD_STAGES, OPEN_LEAD_STAGES, leadStageColor, type LeadStage } from "@/lib/crm/leads";
import { searchContacts } from "@/lib/crm/record-actions";
import { cn } from "@/lib/utils";

const ratingColor = (label: string | null) => FEEDBACK_RATINGS.find((r) => r.value === label)?.color;
const daysAgo = (iso: string | null) => {
  if (!iso) return null;
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 864e5);
  if (d <= 0) return "today";
  if (d === 1) return "yesterday";
  return `${age(d)} ago`;
};
/** 5d, 3mo, 12y */
const age = (days: number) => (days >= 365 ? `${Math.floor(days / 365)}y` : days >= 60 ? `${Math.floor(days / 30)}mo` : `${Math.max(0, days)}d`);
const ageSince = (iso: string | null) => (iso ? age(Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : "");
const isOpen = (stage: string) => OPEN_LEAD_STAGES.includes(stage as LeadStage);

export function LeadsPage({ data }: { data: LeadsData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(data.filters.q);
  const [message, setMessage] = useState<{ text: string; undo?: () => void } | null>(null);
  const [disqualifying, setDisqualifying] = useState<string[] | null>(null);
  const [creating, setCreating] = useState(false);
  const [moved, setMoved] = useState<Record<string, string>>({});
  const rows = data.rows.map((r) => (moved[r.id] ? { ...r, stage: moved[r.id], stageEnteredAt: new Date().toISOString() } : r));

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
  useEffect(() => setMoved({}), [data.rows]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 8000);
    return () => clearTimeout(t);
  }, [message]);

  const run = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, done: string, undo?: () => void) =>
    start(async () => {
      const res = await fn();
      setMessage({ text: res.ok ? done : res.error, undo: res.ok ? undo : undefined });
      if (res.ok) router.refresh();
    });

  /** Move one or more leads; Disqualified asks why. */
  const move = (ids: string[], stage: string, reason?: string) => {
    if (stage === "Disqualified" && !reason) return setDisqualifying(ids);
    setMoved((m) => ({ ...m, ...Object.fromEntries(ids.map((id) => [id, stage])) }));
    start(async () => {
      const res = await moveLeads(ids, stage, reason);
      if (!res.ok) {
        setMoved({});
        return setMessage({ text: res.error });
      }
      setMessage({ text: ids.length === 1 ? `Moved to ${stage}` : `${res.data!.moved} leads moved to ${stage}` });
      router.refresh();
    });
  };

  const chips = [
    { value: "", label: "All", count: data.counts.all, color: undefined as string | undefined },
    ...LEAD_STAGES.map((s) => ({ value: s.value as string, label: s.value as string, count: data.counts[s.value] ?? 0, color: s.color as string | undefined })),
  ];

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="flex flex-wrap items-start gap-3 px-6 pb-2 pt-4">
        <div className="mr-auto">
          <h1 className="text-[22px] font-medium">Leads</h1>
          <p className="mt-1 max-w-[820px] text-[13px] text-ink-muted">
            People you are working toward a sales conversation. Calls move leads from <strong>New</strong> to <strong>Attempting</strong> to <strong>Connected</strong>, and a good conversation
            opens a lead automatically. <strong>Qualify</strong> a lead when it is a real opportunity (its company moves to Opportunity), or <strong>disqualify</strong> it with a reason.
          </p>
        </div>
        <div className="flex overflow-hidden rounded-[3px] border border-line-strong" role="group" aria-label="View">
          {(
            [
              ["board", "Board", Columns3],
              ["list", "List", List],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setParams({ view: v === "board" ? "" : v, page: "" })}
              className={cn("flex h-8 items-center gap-1.5 px-3 text-[13px]", data.view === v ? "bg-[#e5f5f8] font-medium text-link" : "hover:bg-surface-hover")}
              aria-pressed={data.view === v}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus /> Create leads
        </Button>
      </div>

      {data.uncreated > 0 && (
        <div className="mx-6 mb-2 flex flex-wrap items-center gap-3 rounded-[6px] border border-[#b9e3ea] bg-[#f0f9fb] px-3 py-2 text-[13px]">
          <History className="size-4 shrink-0 text-link" />
          <span className="flex-1">
            <strong>{data.uncreated.toLocaleString()}</strong> people have been called but aren&apos;t leads yet. Create their leads from call history: reached people start as Connected, the rest as
            Attempting, and a clear &ldquo;not interested&rdquo; as Disqualified.
          </span>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const res = await createLeadsFromCalls();
                setMessage({ text: res.ok ? `${res.data!.created.toLocaleString()} leads created from call history` : res.error });
                if (res.ok) setParams({ owner: "__all__" });
              })
            }
          >
            Create from call history
          </Button>
        </div>
      )}

      {data.counts.stale > 0 && (
        <button
          onClick={() => setParams({ stage: data.filters.stage === "stale" ? "" : "stale", page: "" })}
          className={cn(
            "mx-6 mb-2 flex items-center gap-2 rounded-[6px] border px-3 py-2 text-left text-[13px]",
            data.filters.stage === "stale" ? "border-[#f2545b] bg-[#fde8e9]" : "border-[#f5c26b] bg-[#fef8ec] hover:bg-[#fdf1d8]",
          )}
        >
          <AlertTriangle className="size-4 shrink-0 text-[#c93a41]" />
          <span>
            <strong>
              {data.counts.stale.toLocaleString()} open {data.counts.stale === 1 ? "lead is" : "leads are"} going cold
            </strong>
            : no call in {STALE_DAYS} days. {data.filters.stage === "stale" ? "Showing them below." : "Click to see them."}
          </span>
        </button>
      )}

      <div className="flex flex-wrap items-center gap-1.5 border-b border-line px-6 pb-2.5">
        {chips.map((c) => (
          <button
            key={c.label}
            onClick={() => setParams({ stage: c.value, page: "" })}
            className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]", data.filters.stage === c.value ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            title={LEAD_STAGES.find((s) => s.value === c.value)?.help}
          >
            {c.color && <span className="size-2 rounded-full" style={{ background: c.color }} />}
            {c.label} {c.count.toLocaleString()}
          </button>
        ))}
        <div className="relative ml-2 w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search people or companies" className="h-8 pl-8" aria-label="Search leads" />
        </div>
        <Select className="h-8 w-[160px]" value={data.filters.owner} onChange={(e) => setParams({ owner: e.target.value, page: "" })} aria-label="Lead owner">
          <option value="__me__">My leads</option>
          <option value="__all__">Everyone&apos;s leads</option>
          <option value="__none__">Unassigned</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-[130px]" value={data.filters.label} onChange={(e) => setParams({ label: e.target.value, page: "" })} aria-label="Label">
          <option value="">Any label</option>
          {FEEDBACK_RATINGS.map((r) => (
            <option key={r.value}>{r.value}</option>
          ))}
          <option value="__none__">No label</option>
        </Select>
        {message && (
          <span className="flex items-center gap-2 text-[13px] text-ink-muted">
            {message.text}
            {message.undo && (
              <button className="font-medium text-link hover:underline" onClick={message.undo}>
                Undo
              </button>
            )}
          </span>
        )}
        {data.view === "list" && (
          <div className="ml-auto">
            <Pager page={data.page} total={data.total} size={LEAD_PAGE} onPage={(p) => setParams({ page: String(p) })} />
          </div>
        )}
      </div>

      {!data.hasLeads && !data.uncreated ? (
        <div className="py-16 text-center">
          <div className="mb-1 text-[16px] font-medium">No leads yet</div>
          <div className="text-[13px] text-ink-muted">Leads open automatically after good conversations on calls, or create them for people you want to work.</div>
        </div>
      ) : data.view === "board" ? (
        <Board data={data} rows={rows} onMove={move} />
      ) : (
        <LeadList
          data={data}
          rows={rows}
          onMove={move}
          onUpdate={(ids, patch, done) => run(() => updateLeads(ids, patch), done)}
          onDelete={(ids) =>
            run(
              () => deleteLeads(ids),
              `${ids.length} ${ids.length === 1 ? "lead" : "leads"} deleted`,
              () => run(() => restoreLeads(ids), "Restored"),
            )
          }
        />
      )}

      {creating && (
        <CreateLeadsDialog
          users={data.users}
          currentUserId={data.currentUserId}
          onClose={() => setCreating(false)}
          onDone={(m) => {
            setCreating(false);
            setMessage({ text: m });
            router.refresh();
          }}
        />
      )}
      {disqualifying && (
        <ReasonDialog
          title={disqualifying.length === 1 ? "Disqualify lead" : `Disqualify ${disqualifying.length} leads`}
          intro="Why isn't this a fit? The reason stays on the lead so nobody chases it again by mistake."
          reasons={DISQUALIFY_REASONS}
          confirm="Disqualify"
          onCancel={() => setDisqualifying(null)}
          onConfirm={(reason) => {
            const ids = disqualifying;
            setDisqualifying(null);
            move(ids, "Disqualified", reason);
          }}
        />
      )}
    </div>
  );
}

function LeadCardBody({ l, data }: { l: LeadRow; data: LeadsData }) {
  const owner = data.users.find((u) => u.id === l.ownerId);
  const overdue = l.next?.at && new Date(l.next.at) < new Date();
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <Link href={`/contacts/${l.contact.id}`} className="block truncate font-medium text-link hover:underline">
            {l.contact.name}
          </Link>
          {l.contact.jobTitle && <div className="truncate text-[12px] text-ink-muted">{l.contact.jobTitle}</div>}
          {l.company && (
            <Link href={`/companies/${l.company.id}`} className="block truncate text-[12px] text-ink-muted hover:underline">
              {l.company.name}
            </Link>
          )}
        </div>
        {l.label && <Pill label={l.label} color={ratingColor(l.label)} />}
      </div>
      <div className="mt-1.5 text-[12px] text-ink-muted">
        {l.touches} {l.touches === 1 ? "call" : "calls"}
        {l.lastTouchAt ? ` · last ${daysAgo(l.lastTouchAt)}` : " · not called yet"}
        {l.lastResult ? ` · ${l.lastResult}` : ""}
      </div>
      {isOpen(l.stage) ? (
        <div className={cn("mt-1 truncate text-[12px]", !l.next ? "text-[#c93a41]" : overdue ? "font-medium text-danger" : "text-ink-muted")}>
          {l.next ? `Next: ${l.next.label}${l.next.at ? ` · ${formatDate(l.next.at)}` : ""}` : "No next step"}
        </div>
      ) : (
        l.stage === "Disqualified" && l.disqualifyReason && <div className="mt-1 text-[12px] text-ink-muted">{l.disqualifyReason}</div>
      )}
      <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-subtle">
        {owner ? <UserAvatar user={owner} size={18} /> : <span>Unassigned</span>}
        <span title="Days in this stage">{ageSince(l.stageEnteredAt)} in stage</span>
        {l.contact.timeZone && <span className="ml-auto"><LocalTime tz={l.contact.timeZone} /></span>}
      </div>
    </>
  );
}

function Board({ data, rows, onMove }: { data: LeadsData; rows: LeadRow[]; onMove: (ids: string[], stage: string) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const stages = data.filters.stage && data.filters.stage !== "stale" ? LEAD_STAGES.filter((s) => s.value === data.filters.stage) : LEAD_STAGES;
  return (
    <div className="thin-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto bg-surface-muted p-3">
      {stages.map((stage) => {
        const items = rows.filter((r) => r.stage === stage.value);
        const total = data.filters.stage === "stale" ? items.length : (data.counts[stage.value] ?? 0);
        return (
          <section
            key={stage.value}
            aria-label={stage.value}
            onDragOver={(e) => (e.preventDefault(), setOver(stage.value))}
            onDragLeave={() => setOver((o) => (o === stage.value ? null : o))}
            onDrop={() => {
              const lead = rows.find((r) => r.id === dragging);
              setDragging(null);
              setOver(null);
              if (lead && lead.stage !== stage.value) onMove([lead.id], stage.value);
            }}
            className={cn("flex w-[272px] shrink-0 flex-col rounded-[4px] border border-line bg-surface", over === stage.value && dragging && "border-link ring-2 ring-link/30")}
          >
            <div className="border-b border-line px-3 py-2" style={{ borderTop: `3px solid ${stage.color}` }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {stage.value} <span className="font-normal text-ink-subtle">{total.toLocaleString()}</span>
              </div>
              <div className="text-[12px] text-ink-muted">{stage.help}</div>
            </div>
            <div className="thin-scroll min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((l) => (
                <article
                  key={l.id}
                  draggable
                  onDragStart={() => setDragging(l.id)}
                  onDragEnd={() => (setDragging(null), setOver(null))}
                  className={cn("cursor-grab rounded-[4px] border border-line bg-surface p-2.5 text-[13px] shadow-sm hover:border-line-strong", dragging === l.id && "opacity-50")}
                >
                  <LeadCardBody l={l} data={data} />
                </article>
              ))}
              {total > items.length && <p className="px-1 py-2 text-center text-[12px] text-ink-subtle">Showing {items.length} of {total.toLocaleString()}. Use the list view for the rest.</p>}
              {!items.length && <p className="px-1 py-4 text-center text-[12px] text-ink-subtle">Drop leads here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function LeadList({
  data,
  rows,
  onMove,
  onUpdate,
  onDelete,
}: {
  data: LeadsData;
  rows: LeadRow[];
  onMove: (ids: string[], stage: string) => void;
  onUpdate: (ids: string[], patch: Parameters<typeof updateLeads>[1], done: string) => void;
  onDelete: (ids: string[]) => void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  useEffect(() => setSelected(new Set()), [data.rows]);
  const ids = [...selected];
  const allOnPage = rows.length > 0 && rows.every((r) => selected.has(r.id));
  return (
    <>
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            <X className="size-3.5" /> Clear
          </button>
          <span className="mx-1 h-5 w-px bg-line" />
          <Select className="h-7 w-[150px]" value="" onChange={(e) => e.target.value && onMove(ids, e.target.value)} aria-label="Move to stage">
            <option value="">Move to stage…</option>
            {LEAD_STAGES.map((s) => (
              <option key={s.value}>{s.value}</option>
            ))}
          </Select>
          <Select
            className="h-7 w-[150px]"
            value=""
            onChange={(e) => e.target.value && onUpdate(ids, { ownerId: e.target.value === "__none__" ? null : e.target.value }, "Owner changed")}
            aria-label="Assign owner"
          >
            <option value="">Assign to…</option>
            <option value="__none__">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </Select>
          <Select className="h-7 w-[120px]" value="" onChange={(e) => e.target.value && onUpdate(ids, { label: e.target.value === "__none__" ? null : e.target.value }, "Label set")} aria-label="Set label">
            <option value="">Label…</option>
            {FEEDBACK_RATINGS.map((r) => (
              <option key={r.value}>{r.value}</option>
            ))}
            <option value="__none__">No label</option>
          </Select>
          <Button size="sm" variant="ghost" className="text-danger" onClick={() => onDelete(ids)}>
            <Trash2 /> Delete
          </Button>
        </div>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1150px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allOnPage ? true : selected.size ? "indeterminate" : false}
                  onCheckedChange={() => setSelected(allOnPage ? new Set() : new Set(rows.map((r) => r.id)))}
                  aria-label="Select this page"
                />
              </th>
              <th className="px-3 py-2">Lead</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Label</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Calls</th>
              <th className="px-3 py-2">Last call</th>
              <th className="px-3 py-2">Next step</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Local time</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.map((l) => {
              const owner = data.users.find((u) => u.id === l.ownerId);
              const overdue = l.next?.at && new Date(l.next.at) < new Date();
              return (
                <tr key={l.id} className={cn("border-b border-line align-top hover:bg-surface-hover", selected.has(l.id) && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(l.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(selected);
                        if (v) n.add(l.id);
                        else n.delete(l.id);
                        setSelected(n);
                      }}
                      aria-label={`Select ${l.name}`}
                    />
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <Link href={`/contacts/${l.contact.id}`} className="block truncate font-medium text-link hover:underline">
                      {l.contact.name}
                    </Link>
                    <div className="truncate text-[12px] text-ink-muted">
                      {[l.contact.jobTitle, l.company?.name].filter(Boolean).join(" · ")}
                    </div>
                  </td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <Pill label={l.stage} color={leadStageColor(l.stage)} />
                    <div className="mt-0.5 text-[12px] text-ink-subtle">{l.stage === "Disqualified" ? l.disqualifyReason : `since ${formatDate(l.stageEnteredAt)}`}</div>
                  </td>
                  <td className="px-3 py-2">{l.label ? <Pill label={l.label} color={ratingColor(l.label)} /> : <span className="text-ink-subtle">--</span>}</td>
                  <td className="whitespace-nowrap px-3 py-2">{owner ? owner.name ?? owner.email : <span className="text-ink-subtle">Unassigned</span>}</td>
                  <td className="px-3 py-2">{l.touches}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    <div>{l.lastTouchAt ? formatDate(l.lastTouchAt) : "--"}</div>
                    <div className="max-w-[180px] truncate text-[12px] text-ink-subtle">{l.lastResult ?? ""}</div>
                  </td>
                  <td className={cn("max-w-[200px] px-3 py-2", overdue && "text-danger")}>
                    {l.next ? (
                      <>
                        <div className="truncate">{l.next.label}</div>
                        <div className="text-[12px]">{l.next.at ? `${overdue ? "Overdue · " : ""}${formatDate(l.next.at)}` : ""}</div>
                      </>
                    ) : (
                      <span className={isOpen(l.stage) ? "text-[#c93a41]" : "text-ink-subtle"}>{isOpen(l.stage) ? "No next step" : "--"}</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{l.campaign ? <Link href={`/campaigns/${l.campaign.id}`} className="hover:underline">{l.campaign.name}</Link> : (l.source ?? "--")}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{l.contact.timeZone ? <LocalTime tz={l.contact.timeZone} /> : "--"}</td>
                  <td className="whitespace-nowrap px-3 py-2">
                    {isOpen(l.stage) && (
                      <Button size="sm" variant="outline" onClick={() => onMove([l.id], "Qualified")}>
                        Qualify
                      </Button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="py-16 text-center">
            <div className="mb-1 text-[16px] font-medium">No leads match</div>
            <div className="text-[13px] text-ink-muted">Try another stage, owner or search. &ldquo;My leads&rdquo; shows only leads you own.</div>
          </div>
        )}
      </div>
    </>
  );
}

function CreateLeadsDialog({ users, currentUserId, onClose, onDone }: { users: LeadsData["users"]; currentUserId: string; onClose: () => void; onDone: (m: string) => void }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<{ id: string; name: string; subtitle: string | null }[]>([]);
  const [picked, setPicked] = useState<{ id: string; name: string }[]>([]);
  const [f, setF] = useState({ ownerId: currentUserId, source: "Cold call", label: "" });
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    const t = setTimeout(() => searchContacts(q).then(setHits), 200);
    return () => clearTimeout(t);
  }, [q]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent side="right" title="Create leads" className="w-[480px]">
        <form
          className="thin-scroll flex-1 space-y-3 overflow-y-auto px-6 py-5"
          onSubmit={(e) => {
            e.preventDefault();
            start(async () => {
              setError(null);
              const res = await createLeads(
                picked.map((p) => p.id),
                { ownerId: f.ownerId || null, source: f.source || null, label: f.label || null },
              );
              if (!res.ok) return setError(res.error);
              const { created, skipped } = res.data!;
              onDone(`${created} ${created === 1 ? "lead" : "leads"} created${skipped ? `, ${skipped} skipped (already an open lead)` : ""}`);
            });
          }}
        >
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
          <p className="text-[13px] text-ink-muted">Tip: to make leads for many people at once, select them on the Contacts page or create them from call history.</p>
          <div>
            <Label htmlFor="l-search">People</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input id="l-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or email" className="pl-8" autoFocus />
            </div>
            <ul className="mt-1 max-h-[180px] overflow-y-auto rounded-[3px] border border-line">
              {hits
                .filter((h) => !picked.some((p) => p.id === h.id))
                .map((h) => (
                  <li key={h.id}>
                    <button type="button" className="w-full truncate px-2.5 py-1.5 text-left text-[13px] hover:bg-surface-hover" onClick={() => setPicked([...picked, { id: h.id, name: h.name }])}>
                      {h.name}
                      {h.subtitle && <span className="text-ink-subtle"> · {h.subtitle}</span>}
                    </button>
                  </li>
                ))}
            </ul>
          </div>
          {picked.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {picked.map((p) => (
                <span key={p.id} className="flex items-center gap-1 rounded-full border border-line bg-surface-muted px-2 py-0.5 text-[12px]">
                  {p.name}
                  <button type="button" onClick={() => setPicked(picked.filter((x) => x.id !== p.id))} aria-label={`Remove ${p.name}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="l-owner">Lead owner</Label>
              <Select id="l-owner" value={f.ownerId} onChange={(e) => setF({ ...f, ownerId: e.target.value })}>
                <option value="">Unassigned</option>
                {users.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {u.id === currentUserId ? " (me)" : ""}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="l-source">Source</Label>
              <Select id="l-source" value={f.source} onChange={(e) => setF({ ...f, source: e.target.value })}>
                {LEAD_SOURCES.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="l-label">Label</Label>
              <Select id="l-label" value={f.label} onChange={(e) => setF({ ...f, label: e.target.value })}>
                <option value="">None</option>
                {FEEDBACK_RATINGS.map((r) => (
                  <option key={r.value}>{r.value}</option>
                ))}
              </Select>
            </div>
          </div>
          <div className="flex justify-end gap-2 border-t border-line pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" variant="primary" disabled={pending || !picked.length}>
              Create {picked.length || ""} {picked.length === 1 ? "lead" : "leads"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
