"use client";

// Deals: the sales pipeline as a board (drag deals between stages) or a list, with pipeline totals and forecast.
import { Columns3, List, Plus, Search, Trash2, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CompanyLogo, Pill, UserAvatar } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import { deleteDeals, moveDeal, restoreDeals } from "@/lib/crm/deal-actions";
import type { DealRow, DealsData } from "@/lib/crm/deal-loader";
import { CLOSE_FILTERS, LOST_REASONS } from "@/lib/crm/deals";
import { cn, formatNumber } from "@/lib/utils";
import { CreateDealDialog } from "./deal-dialog";
import { ReasonDialog } from "./reason-dialog";

const money = (n: number | null | undefined) => (n === null || n === undefined ? "--" : formatNumber(n, "currency"));
const daysSince = (iso: string | null) => (iso ? Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5)) : 0);

export function DealsPage({ data }: { data: DealsData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, start] = useTransition();
  const [q, setQ] = useState(data.filters.q);
  const [creating, setCreating] = useState(false);
  const [message, setMessage] = useState<{ text: string; undo?: () => void } | null>(null);
  const [lost, setLost] = useState<{ deal: DealRow; stageId: string } | null>(null);
  // Optimistic stage moves while the server catches up
  const [moved, setMoved] = useState<Record<string, string>>({});
  const rows = data.rows.map((r) => (moved[r.id] ? { ...r, stageId: moved[r.id], stageEnteredAt: new Date().toISOString() } : r));

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
    const t = setTimeout(() => setParams({ q }), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => setMoved({}), [data.rows]);
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 8000);
    return () => clearTimeout(t);
  }, [message]);

  const move = (deal: DealRow, stageId: string, reason?: string) => {
    const stage = data.stages.find((s) => s.id === stageId);
    if (!stage || deal.stageId === stageId) return;
    if (stage.stageType === "LOST" && !reason) return setLost({ deal, stageId });
    setMoved((m) => ({ ...m, [deal.id]: stageId }));
    start(async () => {
      const res = await moveDeal(deal.id, stageId, reason);
      if (!res.ok) {
        setMoved((m) => {
          const n = { ...m };
          delete n[deal.id];
          return n;
        });
        return setMessage({ text: res.error });
      }
      setMessage({ text: stage.stageType === "WON" ? `${deal.name} won 🎉` : `${deal.name} moved to ${stage.name}` });
      router.refresh();
    });
  };

  const s = data.summary;
  const stats = [
    { label: "Open pipeline", value: money(s.openAmount), sub: `${s.openCount} open ${s.openCount === 1 ? "deal" : "deals"}` },
    { label: "Weighted forecast", value: money(s.weighted), sub: "Amount × stage probability" },
    { label: "Won this month", value: money(s.wonThisMonth.amount), sub: `${s.wonThisMonth.count} ${s.wonThisMonth.count === 1 ? "deal" : "deals"}` },
    { label: "Win rate", value: s.winRate === null ? "--" : `${s.winRate}%`, sub: "Won ÷ (won + lost)" },
  ];

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="flex flex-wrap items-start gap-3 px-6 pb-2 pt-4">
        <div className="mr-auto">
          <h1 className="text-[22px] font-medium">Deals</h1>
          <p className="mt-1 max-w-[760px] text-[13px] text-ink-muted">Real sales opportunities, from the first meeting to won or lost. Drag a deal to move it to another stage.</p>
        </div>
        {data.pipelines.length > 1 && (
          <Select className="h-8 w-[180px]" value={data.pipelineId ?? ""} onChange={(e) => setParams({ pipeline: e.target.value })} aria-label="Pipeline">
            {data.pipelines.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </Select>
        )}
        <div className="flex overflow-hidden rounded-[3px] border border-line-strong" role="group" aria-label="View">
          {(
            [
              ["board", "Board", Columns3],
              ["list", "List", List],
            ] as const
          ).map(([v, label, Icon]) => (
            <button
              key={v}
              onClick={() => setParams({ view: v === "board" ? "" : v })}
              className={cn("flex h-8 items-center gap-1.5 px-3 text-[13px]", data.view === v ? "bg-[#e5f5f8] font-medium text-link" : "hover:bg-surface-hover")}
              aria-pressed={data.view === v}
            >
              <Icon className="size-4" /> {label}
            </button>
          ))}
        </div>
        <Button variant="primary" onClick={() => setCreating(true)}>
          <Plus /> Create deal
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-px border-y border-line bg-line md:grid-cols-4">
        {stats.map((x) => (
          <div key={x.label} className="bg-surface px-6 py-2.5">
            <div className="text-[12px] text-ink-muted">{x.label}</div>
            <div className="text-[20px] font-medium">{x.value}</div>
            <div className="text-[12px] text-ink-subtle">{x.sub}</div>
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
        <div className="relative w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search deals or companies" className="h-8 pl-8" aria-label="Search deals" />
        </div>
        <Select className="h-8 w-[170px]" value={data.filters.owner} onChange={(e) => setParams({ owner: e.target.value })} aria-label="Deal owner">
          <option value="">Any owner</option>
          <option value="__me__">My deals</option>
          <option value="__none__">No owner</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        <Select className="h-8 w-[180px]" value={data.filters.close} onChange={(e) => setParams({ close: e.target.value })} aria-label="Close date">
          {CLOSE_FILTERS.map((c) => (
            <option key={c.value} value={c.value}>
              {c.label}
            </option>
          ))}
        </Select>
        {data.view === "list" && (
          <Select className="h-8 w-[130px]" value={data.filters.status} onChange={(e) => setParams({ status: e.target.value })} aria-label="Status">
            <option value="">All deals</option>
            <option value="open">Open</option>
            <option value="won">Won</option>
            <option value="lost">Lost</option>
          </Select>
        )}
        {s.overdue > 0 && data.filters.close !== "overdue" && (
          <button className="rounded-full border border-[#f5c26b] bg-[#fef8ec] px-2.5 py-0.5 text-[12px] hover:bg-[#fdf1d8]" onClick={() => setParams({ close: "overdue" })}>
            {s.overdue} past close date
          </button>
        )}
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
      </div>

      {data.view === "board" ? (
        <Board data={data} rows={rows} onMove={move} />
      ) : (
        <DealList
          data={data}
          rows={rows}
          onDeleted={(ids) =>
            setMessage({
              text: `${ids.length} ${ids.length === 1 ? "deal" : "deals"} deleted`,
              undo: () =>
                start(async () => {
                  await restoreDeals(ids);
                  setMessage({ text: "Restored" });
                  router.refresh();
                }),
            })
          }
        />
      )}

      {creating && (
        <CreateDealDialog
          defaults={{}}
          onClose={() => setCreating(false)}
          onCreated={(id, m) => {
            setCreating(false);
            setMessage({ text: m });
            router.push(`/deals/${id}`);
          }}
        />
      )}
      {lost && (
        <ReasonDialog
          title="Mark deal as lost"
          intro={`Why was ${lost.deal.name} lost? This helps spot patterns later.`}
          reasons={LOST_REASONS}
          confirm="Mark lost"
          onCancel={() => setLost(null)}
          onConfirm={(reason) => {
            const l = lost;
            setLost(null);
            move(l.deal, l.stageId, reason);
          }}
        />
      )}
    </div>
  );
}

function Board({ data, rows, onMove }: { data: DealsData; rows: DealRow[]; onMove: (deal: DealRow, stageId: string) => void }) {
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  const now = Date.now();
  return (
    <div className="thin-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto bg-surface-muted p-3">
      {data.stages.map((stage) => {
        const items = rows.filter((r) => r.stageId === stage.id);
        const total = items.reduce((n, r) => n + (r.amount ?? 0), 0);
        return (
          <section
            key={stage.id}
            aria-label={stage.name}
            onDragOver={(e) => (e.preventDefault(), setOver(stage.id))}
            onDragLeave={() => setOver((o) => (o === stage.id ? null : o))}
            onDrop={() => {
              const deal = rows.find((r) => r.id === dragging);
              setDragging(null);
              setOver(null);
              if (deal) onMove(deal, stage.id);
            }}
            className={cn("flex w-[268px] shrink-0 flex-col rounded-[4px] border border-line bg-surface", over === stage.id && dragging && "border-link ring-2 ring-link/30")}
          >
            <div className="border-b border-line px-3 py-2" style={{ borderTop: `3px solid ${stage.color}` }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                <span className="truncate">{stage.name}</span>
                <span className="font-normal text-ink-subtle">{items.length}</span>
              </div>
              <div className="mt-0.5 flex justify-between text-[12px] text-ink-muted">
                <span>{money(total)}</span>
                <span title="Win probability">{stage.probability}%</span>
              </div>
            </div>
            <div className="thin-scroll min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((d) => {
                const overdue = d.stageType === "OPEN" && d.closeDate && new Date(d.closeDate).getTime() < now;
                const owner = data.users.find((u) => u.id === d.ownerId);
                return (
                  <article
                    key={d.id}
                    draggable
                    onDragStart={() => setDragging(d.id)}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                    className={cn("cursor-grab rounded-[4px] border border-line bg-surface p-2.5 text-[13px] shadow-sm hover:border-line-strong", dragging === d.id && "opacity-50")}
                  >
                    <Link href={`/deals/${d.id}`} className="block font-medium text-link hover:underline">
                      {d.name}
                    </Link>
                    {d.company && (
                      <Link href={`/companies/${d.company.id}`} className="mt-1 flex items-center gap-1.5 text-[12px] text-ink-muted hover:underline">
                        <CompanyLogo name={d.company.name} domain={d.company.domain} size={16} />
                        <span className="truncate">{d.company.name}</span>
                      </Link>
                    )}
                    <div className="mt-1.5 flex items-center gap-2 text-[12px]">
                      <span className="font-medium">{money(d.amount)}</span>
                      <span className={cn("ml-auto", overdue ? "font-medium text-danger" : "text-ink-subtle")}>{d.closeDate ? `Close ${formatDate(d.closeDate)}` : "No close date"}</span>
                    </div>
                    <div className="mt-1.5 flex items-center gap-2 text-[12px] text-ink-subtle">
                      {owner ? <UserAvatar user={owner} size={18} /> : <span>No owner</span>}
                      <span title="Days in this stage">{daysSince(d.stageEnteredAt)}d in stage</span>
                      {d.dealType && <span className="ml-auto truncate">{d.dealType}</span>}
                    </div>
                    {d.stageType === "LOST" && d.lostReason && <div className="mt-1 text-[12px] text-ink-muted">Lost: {d.lostReason}</div>}
                    {d.stageType === "OPEN" && (
                      <div className={cn("mt-1 truncate text-[12px]", d.next ? "text-ink-muted" : "text-[#c93a41]")}>{d.next ? `Next: ${d.next.label}${d.next.at ? ` · ${formatDate(d.next.at)}` : ""}` : "No next step"}</div>
                    )}
                  </article>
                );
              })}
              {!items.length && <p className="px-1 py-4 text-center text-[12px] text-ink-subtle">Drop deals here</p>}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function DealList({ data, rows, onDeleted }: { data: DealsData; rows: DealRow[]; onDeleted: (ids: string[]) => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const now = Date.now();
  return (
    <>
      {selected.size > 0 && (
        <div className="flex items-center gap-2 border-b border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          <span className="font-medium">{selected.size} selected</span>
          <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={() => setSelected(new Set())}>
            <X className="size-3.5" /> Clear
          </button>
          <Button
            size="sm"
            variant="ghost"
            className="text-danger"
            disabled={pending}
            onClick={() =>
              start(async () => {
                const ids = [...selected];
                const res = await deleteDeals(ids);
                if (res.ok) {
                  setSelected(new Set());
                  onDeleted(ids);
                  router.refresh();
                }
              })
            }
          >
            <Trash2 /> Delete
          </Button>
        </div>
      )}
      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[1100px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox checked={allSelected ? true : selected.size ? "indeterminate" : false} onCheckedChange={() => setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)))} aria-label="Select all" />
              </th>
              <th className="px-3 py-2">Deal</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2 text-right">Amount</th>
              <th className="px-3 py-2">Close date</th>
              <th className="px-3 py-2">Owner</th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">People</th>
              <th className="px-3 py-2">In stage</th>
              <th className="px-3 py-2">Next step</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((d) => {
              const stage = data.stages.find((s) => s.id === d.stageId);
              const overdue = d.stageType === "OPEN" && d.closeDate && new Date(d.closeDate).getTime() < now;
              const owner = data.users.find((u) => u.id === d.ownerId);
              return (
                <tr key={d.id} className={cn("border-b border-line hover:bg-surface-hover", selected.has(d.id) && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-2">
                    <Checkbox
                      checked={selected.has(d.id)}
                      onCheckedChange={(v) => {
                        const n = new Set(selected);
                        if (v) n.add(d.id);
                        else n.delete(d.id);
                        setSelected(n);
                      }}
                      aria-label={`Select ${d.name}`}
                    />
                  </td>
                  <td className="max-w-[260px] px-3 py-2">
                    <Link href={`/deals/${d.id}`} className="block truncate font-medium text-link hover:underline">
                      {d.name}
                    </Link>
                    {d.dealType && <div className="text-[12px] text-ink-subtle">{d.dealType}</div>}
                  </td>
                  <td className="px-3 py-2">{stage && <Pill label={stage.name} color={stage.color} />}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-right">{money(d.amount)}</td>
                  <td className={cn("whitespace-nowrap px-3 py-2", overdue && "font-medium text-danger")}>{d.closeDate ? formatDate(d.closeDate) : "--"}</td>
                  <td className="whitespace-nowrap px-3 py-2">{owner ? owner.name ?? owner.email : <span className="text-ink-subtle">No owner</span>}</td>
                  <td className="max-w-[200px] truncate px-3 py-2">
                    {d.company ? (
                      <Link href={`/companies/${d.company.id}`} className="text-link hover:underline">
                        {d.company.name}
                      </Link>
                    ) : (
                      "--"
                    )}
                  </td>
                  <td className="max-w-[200px] truncate px-3 py-2 text-ink-muted">{d.contacts.map((c) => c.name).join(", ") || "--"}</td>
                  <td className="whitespace-nowrap px-3 py-2 text-ink-muted">{d.stageType === "OPEN" ? `${daysSince(d.stageEnteredAt)} days` : d.closedAt ? `Closed ${formatDate(d.closedAt)}` : "--"}</td>
                  <td className="max-w-[220px] truncate px-3 py-2 text-ink-muted">{d.next ? `${d.next.label}${d.next.at ? ` · ${formatDate(d.next.at)}` : ""}` : "--"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && (
          <div className="py-16 text-center">
            <div className="mb-1 text-[16px] font-medium">No deals match</div>
            <div className="text-[13px] text-ink-muted">Create a deal when a conversation turns into a real opportunity, or qualify a lead on the Leads page.</div>
          </div>
        )}
      </div>
    </>
  );
}
