"use client";

// Research Queue list: page through thousands of companies, select a page or everything matching, then assign or move in bulk.
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { CompanyLogo, Pill } from "@/components/index/values";
import { Button, Select } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { moveResearchCards } from "@/lib/crm/company-actions";
import { RESEARCH_COLUMNS, type ResearchColumn } from "@/lib/crm/research";
import { assignResearchers, researchIdsMatching } from "@/lib/crm/research-actions";
import { LIST_PAGE, type ResearchData } from "@/lib/crm/research-loader";
import type { UserLite } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));

/** Run a bulk job in chunks so each request stays short, reporting progress as it goes. */
export async function inChunks<T>(items: T[], size: number, run: (chunk: T[]) => Promise<void>, onProgress: (done: number) => void) {
  for (let i = 0; i < items.length; i += size) {
    await run(items.slice(i, i + size));
    onProgress(Math.min(items.length, i + size));
  }
}

export function Progress({ label, done, total }: { label: string; done: number; total: number }) {
  return (
    <div className="flex min-w-[260px] items-center gap-2 text-[13px]">
      <span className="shrink-0">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-muted">
        <div className="h-full bg-link transition-all" style={{ width: `${total ? Math.round((done / total) * 100) : 0}%` }} />
      </div>
      <span className="shrink-0 tabular-nums text-ink-muted">
        {done.toLocaleString()} / {total.toLocaleString()}
      </span>
    </div>
  );
}

export function Pager({ page, total, size, onPage }: { page: number; total: number; size: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / size));
  return (
    <div className="flex items-center gap-2 text-[13px] text-ink-muted">
      <span>
        {total ? `${((page - 1) * size + 1).toLocaleString()}–${Math.min(page * size, total).toLocaleString()} of ${total.toLocaleString()}` : "0"}
      </span>
      <Button size="icon-sm" variant="ghost" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page">
        <ChevronLeft />
      </Button>
      <span className="tabular-nums">
        Page {page} of {pages}
      </span>
      <Button size="icon-sm" variant="ghost" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page">
        <ChevronRight />
      </Button>
    </div>
  );
}

/** Researchers first (people with the Researcher role), then everyone else. */
export function researcherOptions(users: UserLite[], researcherIds: string[]) {
  return [...users.filter((u) => researcherIds.includes(u.id)), ...users.filter((u) => !researcherIds.includes(u.id))];
}

export function ResearchList({ data, setParams, onMessage }: { data: ResearchData; setParams: (p: Record<string, string>) => void; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  /** Every company matching the filters is selected, not just the ticked rows */
  const [allMatching, setAllMatching] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<{ label: string; done: number; total: number } | null>(null);
  const [assignTo, setAssignTo] = useState("");
  const [spread, setSpread] = useState<string[]>([]);
  const [moveTo, setMoveTo] = useState("");
  const { stage, page, total } = data.list;
  const rows = data.cards;
  const pageIds = rows.map((r) => r.id);
  const allOnPage = pageIds.length > 0 && pageIds.every((id) => selected.has(id));
  const count = allMatching ? allMatching.length : selected.size;
  const people = researcherOptions(data.users, data.researcherIds);
  const userOf = (id: string | null) => data.users.find((u) => u.id === id);

  // A different page or filter keeps a row selection but drops "all matching"
  useEffect(() => setAllMatching(null), [data.filters, stage]);

  const clear = () => {
    setSelected(new Set());
    setAllMatching(null);
  };
  const ids = () => allMatching ?? [...selected];

  async function selectAllMatching() {
    const res = await researchIdsMatching(data.filters, stage);
    if (!res.ok) return onMessage(res.error);
    setAllMatching(res.data!);
  }

  async function assign() {
    const target = assignTo === "__spread__" ? spread : assignTo === "__none__" ? [] : [assignTo];
    if (assignTo === "__spread__" && target.length < 2) return onMessage("Tick at least two researchers to spread the companies across");
    const list = ids();
    setBusy({ label: "Assigning", done: 0, total: list.length });
    const res = await assignResearchers(list, target);
    setBusy(null);
    if (!res.ok) return onMessage(res.error);
    onMessage(
      assignTo === "__spread__"
        ? `${list.length.toLocaleString()} companies spread across ${target.length} researchers (about ${Math.ceil(list.length / target.length).toLocaleString()} each)`
        : assignTo === "__none__"
          ? `${list.length.toLocaleString()} companies unassigned`
          : `${list.length.toLocaleString()} companies assigned to ${userOf(assignTo)?.name ?? "the researcher"}`,
    );
    clear();
    router.refresh();
  }

  async function move() {
    const column = moveTo as ResearchColumn;
    const list = ids();
    let failed = 0;
    const reasons: string[] = [];
    setBusy({ label: "Moving", done: 0, total: list.length });
    // Each move updates several fields and the lead journey, so send 25 at a time
    await inChunks(
      list,
      25,
      async (chunk) => {
        const res = await moveResearchCards(chunk, column);
        failed += res.ok ? res.data!.failed : chunk.length;
        if (res.ok) reasons.push(...res.data!.reasons);
        else reasons.push(res.error);
      },
      (done) => setBusy((b) => (b ? { ...b, done } : b)),
    );
    setBusy(null);
    const label = RESEARCH_COLUMNS.find((c) => c.id === column)!.label;
    // The checklist's reason, e.g. "Not ready to call yet. Missing: Time zone (12)"
    const why = [...new Set(reasons.map((r) => r.replace(/ \(\d+\)$/, "")))].slice(0, 2).join("; ");
    onMessage(`${(list.length - failed).toLocaleString()} companies moved to ${label}${failed ? `, ${failed} not moved${why ? `: ${why}` : ""}` : ""}`);
    clear();
    router.refresh();
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Stage chips with counts */}
      <div className="flex flex-wrap items-center gap-1.5 px-6 py-2">
        <button
          className={cn("rounded-full border px-2.5 py-0.5 text-[12px]", !stage ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
          onClick={() => setParams({ stage: "", page: "" })}
        >
          All stages {data.total.toLocaleString()}
        </button>
        {RESEARCH_COLUMNS.map((c) => (
          <button
            key={c.id}
            className={cn("flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[12px]", stage === c.id ? "border-link bg-[#e5f5f8] font-medium" : "border-line hover:bg-surface-hover")}
            onClick={() => setParams({ stage: c.id, page: "" })}
          >
            <span className="size-2 rounded-full" style={{ background: c.color }} />
            {c.label} {data.counts[c.id].toLocaleString()}
          </button>
        ))}
        <div className="ml-auto">
          <Pager page={page} total={total} size={LIST_PAGE} onPage={(p) => setParams({ page: String(p) })} />
        </div>
      </div>

      {/* Bulk bar */}
      {(count > 0 || busy) && (
        <div className="flex flex-wrap items-center gap-2 border-y border-line bg-[#f0f9fb] px-6 py-2 text-[13px]">
          {busy ? (
            <Progress {...busy} />
          ) : (
            <>
              <span className="font-medium">{count.toLocaleString()} selected</span>
              {!allMatching && allOnPage && total > pageIds.length && (
                <button className="text-link hover:underline" onClick={() => void selectAllMatching()}>
                  Select all {total.toLocaleString()} matching
                </button>
              )}
              <button className="flex items-center gap-1 text-ink-muted hover:text-ink" onClick={clear}>
                <X className="size-3.5" /> Clear
              </button>
              <span className="mx-1 h-5 w-px bg-line" />
              <Select className="h-8 w-[200px]" value={assignTo} onChange={(e) => setAssignTo(e.target.value)} aria-label="Assign to">
                <option value="">Assign researcher…</option>
                <option value="__spread__">Spread evenly across several…</option>
                <option value="__none__">Unassign</option>
                {people.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name ?? u.email}
                    {data.researcherIds.includes(u.id) ? " (researcher)" : ""}
                  </option>
                ))}
              </Select>
              {assignTo && (
                <Button size="sm" variant="primary" onClick={() => void assign()}>
                  Assign
                </Button>
              )}
              <span className="mx-1 h-5 w-px bg-line" />
              <Select className="h-8 w-[160px]" value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to">
                <option value="">Move to…</option>
                {RESEARCH_COLUMNS.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.label}
                  </option>
                ))}
              </Select>
              {moveTo && (
                <Button size="sm" variant="primary" onClick={() => void move()}>
                  Move
                </Button>
              )}
              {assignTo === "__spread__" && (
                <div className="flex w-full flex-wrap items-center gap-x-3 gap-y-1 pt-1">
                  <span className="text-ink-muted">Spread across:</span>
                  {people.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-1.5">
                      <input
                        type="checkbox"
                        className="accent-[var(--link)]"
                        checked={spread.includes(u.id)}
                        onChange={(e) => setSpread((s) => (e.target.checked ? [...s, u.id] : s.filter((x) => x !== u.id)))}
                      />
                      {u.name ?? u.email}
                    </label>
                  ))}
                  {spread.length > 1 && <span className="text-ink-subtle">≈ {Math.ceil(count / spread.length).toLocaleString()} each</span>}
                </div>
              )}
            </>
          )}
        </div>
      )}

      <div className="thin-scroll min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[900px] border-collapse text-[13px]">
          <thead className="sticky top-0 z-10 bg-surface-muted text-left text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">
            <tr>
              <th className="w-10 px-3 py-2">
                <Checkbox
                  checked={allMatching ? true : allOnPage ? true : pageIds.some((id) => selected.has(id)) ? "indeterminate" : false}
                  onCheckedChange={(v) => {
                    setAllMatching(null);
                    setSelected((s) => {
                      const n = new Set(s);
                      for (const id of pageIds) {
                        if (v === true) n.add(id);
                        else n.delete(id);
                      }
                      return n;
                    });
                  }}
                  aria-label="Select this page"
                />
              </th>
              <th className="px-3 py-2">Company</th>
              <th className="px-3 py-2">Stage</th>
              <th className="px-3 py-2">Researcher</th>
              <th className="px-3 py-2">Source</th>
              <th className="px-3 py-2">Batch</th>
              <th className="px-3 py-2 text-right">People</th>
              <th className="px-3 py-2 text-right">Numbers</th>
              <th className="px-3 py-2 text-right">Waiting</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => {
              const col = RESEARCH_COLUMNS.find((c) => c.id === r.column)!;
              const checked = !!allMatching || selected.has(r.id);
              return (
                <tr key={r.id} className={cn("border-b border-line hover:bg-surface-hover", checked && "bg-[#f0f9fb]")}>
                  <td className="px-3 py-1.5">
                    <Checkbox
                      checked={checked}
                      onCheckedChange={(v) => {
                        if (allMatching) {
                          // Unticking one row turns "all matching" into an explicit selection without it
                          setSelected(new Set(allMatching.filter((id) => id !== r.id)));
                          return setAllMatching(null);
                        }
                        setSelected((s) => {
                          const n = new Set(s);
                          if (v === true) n.add(r.id);
                          else n.delete(r.id);
                          return n;
                        });
                      }}
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td className="max-w-[280px] px-3 py-1.5">
                    <div className="flex items-center gap-2">
                      <CompanyLogo name={r.name} domain={r.domain} size={20} />
                      <div className="min-w-0">
                        <Link href={`/companies/${r.id}`} className="block truncate font-medium text-link hover:underline">
                          {r.name}
                        </Link>
                        {r.domain && <div className="truncate text-[12px] text-ink-subtle">{r.domain}</div>}
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-1.5">
                    <Pill label={col.label} color={col.color} />
                  </td>
                  <td className="px-3 py-1.5">{userOf(r.researcherId)?.name ?? <span className="text-ink-subtle">Unassigned</span>}</td>
                  <td className="max-w-[180px] truncate px-3 py-1.5">{r.source ?? "--"}</td>
                  <td className="px-3 py-1.5">{r.batchNumber ?? "--"}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.contacts}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums">{r.phones}</td>
                  <td className="px-3 py-1.5 text-right tabular-nums text-ink-muted">{daysSince(r.since)}d</td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!rows.length && <p className="py-12 text-center text-[13px] text-ink-subtle">No companies match these filters.</p>}
      </div>
      <div className="flex justify-end border-t border-line px-6 py-2">
        <Pager page={page} total={total} size={LIST_PAGE} onPage={(p) => setParams({ page: String(p) })} />
      </div>
    </div>
  );
}
