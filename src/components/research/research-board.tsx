"use client";

import { Building2, FileSpreadsheet, FlaskConical, KanbanSquare, List, Phone, Plus, Search, Sparkles, UserRound } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CompanyLogo, Pill, UserAvatar } from "@/components/index/values";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent, Tooltip } from "@/components/ui/overlays";
import { intakeCompanies, moveResearchCard, type IntakeResult } from "@/lib/crm/company-actions";
import { RESEARCH_COLUMNS, type ResearchColumn } from "@/lib/crm/research";
import { loadMoreResearchCards } from "@/lib/crm/research-actions";
import type { ResearchCard, ResearchData } from "@/lib/crm/research-loader";
import { cn } from "@/lib/utils";
import { CallerRequests } from "./caller-requests";
import { ResearchList } from "./research-list";

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));

export function ResearchBoard({ data }: { data: ResearchData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [intakeOpen, setIntakeOpen] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [q, setQ] = useState(data.filters.q);

  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(null), 6000);
    return () => clearTimeout(t);
  }, [message]);

  const setParams = (patch: Record<string, string>) => {
    const p = new URLSearchParams(sp.toString());
    for (const [k, v] of Object.entries(patch)) {
      if (v) p.set(k, v);
      else p.delete(k);
    }
    startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
  };
  // A filter change starts the list from its first page
  const setFilter = (k: string, v: string) => setParams({ [k]: v, page: "" });
  useEffect(() => {
    if (q === data.filters.q) return;
    const t = setTimeout(() => setFilter("q", q), 300);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  const tabs = [
    { id: "board", label: "Board", icon: KanbanSquare, count: data.total },
    { id: "list", label: "List & bulk actions", icon: List, count: data.total },
    { id: "requests", label: "Caller requests", icon: FlaskConical, count: data.requests.waiting },
  ] as const;

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      <div className="flex flex-wrap items-center gap-2 px-6 pb-2 pt-4">
        <h1 className="text-[22px] font-medium">Research Queue</h1>
        <span className="text-[13px] text-ink-subtle">{data.total.toLocaleString()} companies</span>
        <div className="ml-auto flex gap-2">
          <Link href="/import?object=companies&research=1" className="inline-flex h-9 items-center gap-1.5 rounded-[3px] border border-line-strong px-3 text-[13px] font-medium hover:bg-surface-hover">
            <FileSpreadsheet className="size-4" /> Import CSV / Excel
          </Link>
          <Button variant="primary" onClick={() => setIntakeOpen(true)}>
            <Plus /> Paste companies
          </Button>
        </div>
      </div>
      <p className="px-6 pb-3 text-[13px] text-ink-muted">
        Companies sourced from Seamless.AI, Apollo, Sales Navigator, Lusha, directories and portals land here. Research them, then move each one to Viable, Callable or Not viable. Use{" "}
        <strong>List &amp; bulk actions</strong> to assign or move hundreds at once, and <strong>Caller requests</strong> for what callers asked you to look into.
      </p>

      <div className="flex gap-1 border-b border-line px-6" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={data.view === t.id}
            onClick={() => setParams({ view: t.id === "board" ? "" : t.id })}
            className={cn(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13px] font-medium",
              data.view === t.id ? "border-link text-ink" : "border-transparent text-ink-muted hover:text-ink",
            )}
          >
            <t.icon className="size-4" />
            {t.label}
            <span
              className={cn(
                "rounded-full px-1.5 text-[12px]",
                t.id === "requests" && t.count ? "bg-[#f5c26b] text-[#5c3d00]" : "bg-surface-muted text-ink-muted",
              )}
            >
              {t.count.toLocaleString()}
            </span>
          </button>
        ))}
      </div>

      {data.view !== "requests" && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-6 py-2.5">
          <div className="relative w-[220px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name or domain" className="pl-8" aria-label="Search companies" />
          </div>
          <Select className="w-[170px]" value={data.filters.researcher} onChange={(e) => setFilter("researcher", e.target.value)} aria-label="Researcher">
            <option value="">Any researcher</option>
            <option value="__me__">Mine</option>
            <option value="__none__">Unassigned</option>
            {data.users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
          </Select>
          <Select className="w-[200px]" value={data.filters.source} onChange={(e) => setFilter("source", e.target.value)} aria-label="Lead source">
            <option value="">Any source</option>
            {data.sources.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Select className="w-[140px]" value={data.filters.batch} onChange={(e) => setFilter("batch", e.target.value)} aria-label="Batch">
            <option value="">Any batch</option>
            {data.batches.map((b) => (
              <option key={b} value={b}>
                {b}
              </option>
            ))}
          </Select>
          {message && <span className="ml-auto text-[13px] text-ink-muted">{message}</span>}
        </div>
      )}

      {data.view === "board" && <BoardView key={JSON.stringify(data.filters)} data={data} onMessage={setMessage} />}
      {data.view === "list" && <ResearchList data={data} setParams={setParams} onMessage={setMessage} />}
      {data.view === "requests" && <CallerRequests data={data} setParams={setParams} onMessage={setMessage} message={message} />}

      <IntakeDialog
        open={intakeOpen}
        onOpenChange={setIntakeOpen}
        data={data}
        onDone={(r) => {
          setMessage(`Added ${r.created.length} companies${r.duplicates.length ? `, skipped ${r.duplicates.length} already in the CRM` : ""}${r.enriched ? `, enriched ${r.enriched}` : ""}`);
          router.refresh();
        }}
      />
    </div>
  );
}

/** Kanban of the first cards per column; each column loads more on demand, so thousands of companies stay quick. */
function BoardView({ data, onMessage }: { data: ResearchData; onMessage: (m: string) => void }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [cards, setCards] = useState<ResearchCard[]>(data.cards);
  const [counts, setCounts] = useState(data.counts);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<ResearchColumn | null>(null);
  const [loading, setLoading] = useState<ResearchColumn | null>(null);

  useEffect(() => {
    setCards(data.cards);
    setCounts(data.counts);
  }, [data.cards, data.counts]);

  function drop(column: ResearchColumn) {
    const id = dragging;
    setDragging(null);
    setOver(null);
    const card = cards.find((c) => c.id === id);
    if (!card || card.column === column) return;
    // Optimistic move; the server sets research/viability fields and the journey follows
    setCards((cs) => cs.map((c) => (c.id === id ? { ...c, column, since: new Date().toISOString() } : c)));
    setCounts((n) => ({ ...n, [card.column]: n[card.column] - 1, [column]: n[column] + 1 }));
    startTransition(async () => {
      const res = await moveResearchCard(card.id, column);
      if (!res.ok) {
        setCards(data.cards);
        setCounts(data.counts);
        return onMessage(res.error);
      }
      onMessage(`${card.name} → ${RESEARCH_COLUMNS.find((c) => c.id === column)!.label}`);
      router.refresh();
    });
  }

  async function loadMore(column: ResearchColumn) {
    setLoading(column);
    const shown = cards.filter((c) => c.column === column).length;
    const res = await loadMoreResearchCards(data.filters, column, shown);
    setLoading(null);
    if (!res.ok) return onMessage(res.error);
    setCards((cs) => [...cs, ...res.data!.filter((n) => !cs.some((c) => c.id === n.id))]);
  }

  const userOf = (id: string | null) => data.users.find((u) => u.id === id);

  return (
    <div className={cn("thin-scroll flex min-h-0 flex-1 gap-3 overflow-x-auto bg-surface-muted p-3", pending && "opacity-80")}>
      {RESEARCH_COLUMNS.map((col) => {
        const items = cards.filter((c) => c.column === col.id);
        const left = counts[col.id] - items.length;
        return (
          <section
            key={col.id}
            aria-label={col.label}
            onDragOver={(e) => {
              e.preventDefault();
              setOver(col.id);
            }}
            onDragLeave={() => setOver((o) => (o === col.id ? null : o))}
            onDrop={() => drop(col.id)}
            className={cn("flex w-[260px] shrink-0 flex-col rounded-[4px] border border-line bg-surface", over === col.id && dragging && "border-link ring-2 ring-link/30")}
          >
            <div className="border-b border-line px-3 py-2" style={{ borderTop: `3px solid ${col.color}` }}>
              <div className="flex items-center gap-2 text-[13px] font-semibold">
                {col.label}
                <span className="font-normal text-ink-subtle">{counts[col.id].toLocaleString()}</span>
              </div>
              <div className="text-[11px] text-ink-subtle">{col.help}</div>
            </div>
            <div className="thin-scroll min-h-[120px] flex-1 space-y-2 overflow-y-auto p-2">
              {items.map((c) => {
                const researcher = userOf(c.researcherId);
                return (
                  <article
                    key={c.id}
                    draggable
                    onDragStart={(e) => {
                      setDragging(c.id);
                      e.dataTransfer.effectAllowed = "move";
                    }}
                    onDragEnd={() => (setDragging(null), setOver(null))}
                    className={cn("cursor-grab rounded-[4px] border border-line bg-surface p-2.5 text-[13px] shadow-sm hover:border-line-strong", dragging === c.id && "opacity-50")}
                  >
                    <div className="flex items-start gap-2">
                      <CompanyLogo name={c.name} domain={c.domain} size={20} />
                      <div className="min-w-0 flex-1">
                        <Link href={`/companies/${c.id}`} className="block truncate font-medium text-link hover:underline">
                          {c.name}
                        </Link>
                        {c.domain && <div className="truncate text-[12px] text-ink-subtle">{c.domain}</div>}
                      </div>
                      {researcher ? (
                        <Tooltip content={`Researcher: ${researcher.name ?? researcher.email}`}>
                          <span>
                            <UserAvatar user={researcher} size={20} />
                          </span>
                        </Tooltip>
                      ) : (
                        <Tooltip content="No researcher yet: moving the card assigns it to you">
                          <span className="flex size-5 items-center justify-center rounded-full border border-dashed border-line-strong text-ink-subtle">
                            <UserRound className="size-3" />
                          </span>
                        </Tooltip>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {c.source && <Pill label={c.source} />}
                      {c.batchNumber && <Pill label={c.batchNumber} />}
                      {c.signalTypes.slice(0, 1).map((s) => (
                        <Pill key={s} label={s} color="#6a78d1" />
                      ))}
                    </div>
                    <div className="mt-1.5 flex items-center gap-3 text-[12px] text-ink-subtle">
                      <span className="flex items-center gap-1" title="Contacts (targets)">
                        <UserRound className="size-3" /> {c.contacts}
                      </span>
                      <span className="flex items-center gap-1" title="Phone numbers">
                        <Phone className="size-3" /> {c.phones}
                      </span>
                      {c.employees ? (
                        <span className="flex items-center gap-1" title="Employees">
                          <Building2 className="size-3" /> {c.employees.toLocaleString()}
                        </span>
                      ) : null}
                      {c.enriched && (
                        <span title="Enriched from an integration">
                          <Sparkles className="size-3" />
                        </span>
                      )}
                      <span className="ml-auto">{daysSince(c.since)}d</span>
                    </div>
                    {c.missing.length > 0 ? (
                      <div className="mt-1.5 rounded-[3px] bg-[#fdf3e1] px-1.5 py-0.5 text-[11px] text-[#8a5a00]" title="Needed before this company can be marked Callable">
                        To be ready: {c.missing.join(", ")}
                      </div>
                    ) : (
                      (c.column === "researched" || c.column === "viable") && (
                        <div className="mt-1.5 rounded-[3px] bg-[#e5f8f6] px-1.5 py-0.5 text-[11px] text-[#00806e]">Ready to call: all checks pass</div>
                      )
                    )}
                  </article>
                );
              })}
              {!items.length && <p className="px-1 py-4 text-center text-[12px] text-ink-subtle">Drop companies here</p>}
              {left > 0 && (
                <button
                  className="w-full rounded-[4px] border border-dashed border-line-strong py-2 text-[12px] text-link hover:bg-surface-hover disabled:opacity-50"
                  disabled={loading === col.id}
                  onClick={() => void loadMore(col.id)}
                >
                  {loading === col.id ? "Loading…" : `Load more (${left.toLocaleString()} more)`}
                </button>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function IntakeDialog({ open, onOpenChange, data, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; data: ResearchData; onDone: (r: IntakeResult) => void }) {
  const [lines, setLines] = useState("");
  const [source, setSource] = useState("");
  const [listSource, setListSource] = useState("");
  const [batch, setBatch] = useState("");
  const [researcherId, setResearcherId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<IntakeResult | null>(null);
  const [pending, start] = useTransition();
  const count = lines.split(/\r?\n/).filter((l) => l.trim()).length;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        onOpenChange(o);
        if (o) {
          setLines("");
          setError(null);
          setResult(null);
          setResearcherId(data.currentUserId);
        }
      }}
    >
      <DialogContent title="Paste sourced companies" className="w-[640px]">
        {result ? (
          <div className="space-y-3 px-6 py-5 text-[13px]">
            <p>
              <strong>{result.created.length}</strong> companies added to the research queue as <em>Sourced</em>.
            </p>
            {result.duplicates.length > 0 && (
              <div>
                <div className="font-medium">Already in the CRM ({result.duplicates.length}), skipped:</div>
                <ul className="thin-scroll mt-1 max-h-[160px] space-y-0.5 overflow-y-auto">
                  {result.duplicates.map((d) => (
                    <li key={d.id}>
                      <Link href={`/companies/${d.id}`} className="text-link hover:underline">
                        {d.name}
                      </Link>{" "}
                      <span className="text-ink-subtle">({d.line})</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {result.invalid.length > 0 && (
              <div className="text-danger">
                Couldn&apos;t read {result.invalid.length} line{result.invalid.length === 1 ? "" : "s"}: {result.invalid.slice(0, 5).join("; ")}
              </div>
            )}
            <div className="flex justify-end">
              <Button variant="primary" onClick={() => onOpenChange(false)}>
                Done
              </Button>
            </div>
          </div>
        ) : (
          <form
            className="space-y-4 px-6 py-5"
            onSubmit={(e) => {
              e.preventDefault();
              start(async () => {
                setError(null);
                const res = await intakeCompanies({ lines, source, listSource: listSource || null, batchNumber: batch || null, researcherId: researcherId || null });
                if (!res.ok) return setError(res.error);
                setResult(res.data!);
                onDone(res.data!);
              });
            }}
          >
            {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}
            <div>
              <Label htmlFor="intake-lines">Companies, one per line</Label>
              <textarea
                id="intake-lines"
                value={lines}
                onChange={(e) => setLines(e.target.value)}
                rows={9}
                autoFocus
                placeholder={"Acme Analytics, acmeanalytics.com\nhttps://www.brightpath.io\nNorthwind Health; northwindhealth.com"}
                className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 font-mono text-[12px] outline-none focus:border-link"
              />
              <p className="mt-1 text-[12px] text-ink-subtle">
                Paste from a Seamless.AI, Apollo, Sales Navigator, Lusha or ZoomInfo export, or a directory. &ldquo;Name, domain&rdquo;, a domain or a website URL per line. Duplicates are matched on domain.
                {count ? ` ${count} lines.` : ""}
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="intake-source">Lead source *</Label>
                <Select id="intake-source" value={source} onChange={(e) => setSource(e.target.value)}>
                  <option value="">Choose a source</option>
                  {data.sources.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="intake-list">Topic / list source</Label>
                <Select id="intake-list" value={listSource} onChange={(e) => setListSource(e.target.value)}>
                  <option value="">--</option>
                  {data.listSources.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="intake-batch">Batch number</Label>
                <Input id="intake-batch" value={batch} onChange={(e) => setBatch(e.target.value)} placeholder="e.g. B-17" maxLength={40} />
              </div>
              <div>
                <Label htmlFor="intake-researcher">Researcher</Label>
                <Select id="intake-researcher" value={researcherId} onChange={(e) => setResearcherId(e.target.value)}>
                  <option value="">Unassigned</option>
                  {data.users.map((u) => (
                    <option key={u.id} value={u.id}>
                      {u.name ?? u.email}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {data.autoEnrich.length > 0 && <p className="text-[12px] text-ink-muted">New companies with a domain are enriched automatically from {data.autoEnrich.join(" and ")} (first 25).</p>}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
                Cancel
              </Button>
              <Button type="submit" variant="primary" disabled={pending || !count || !source}>
                {pending ? "Adding…" : `Add ${count || ""} companies`}
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
