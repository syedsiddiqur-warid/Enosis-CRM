"use client";

import { Check, FlaskConical, Pencil, Plus, Search, X } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { conditionDef, conditionPrefix, describeCondition } from "@/components/index/filter-editor";
import { Button, Input } from "@/components/ui/button";
import { Checkbox, Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { formatDate } from "@/lib/crm/dates";
import { searchRecords, testSegmentMatch } from "@/lib/crm/insight-actions";
import type { MatchReport } from "@/lib/crm/insights";
import { updateSegment } from "@/lib/crm/segment-actions";
import type { CrmObject, FilterGroup, PropDef, RelatedDefs, SegmentExclusions, SegmentSummary, UserLite } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type RecordHit = Awaited<ReturnType<typeof searchRecords>>[number];

/** Size, share of the database, 7-day change, created on, type — the segment's headline row. */
export function SegmentStats({ size, database, change7d, createdAt, type, plural, dirty }: { size: number; database: number; change7d: number | null; createdAt: string; type: "ACTIVE" | "STATIC"; plural: string; dirty: boolean }) {
  const cells: [string, React.ReactNode, string][] = [
    ["Size", size.toLocaleString(), dirty ? `${plural} with the draft filters` : plural],
    ["% of database", database ? `${((size / database) * 100).toFixed(size / database < 0.1 && size ? 1 : 0)}%` : "0%", `of ${database.toLocaleString()} ${plural}`],
    ["7-day change", change7d === null ? "--" : `${change7d > 0 ? "+" : ""}${change7d.toLocaleString()}`, change7d === null ? "Shown after a week of history" : "since a week ago"],
    ["Created on", formatDate(createdAt), ""],
    ["Type", type === "ACTIVE" ? "Active" : "Static", type === "ACTIVE" ? "Updates automatically" : "Fixed list"],
  ];
  return (
    <div className="mx-6 mb-3 grid grid-cols-2 gap-px overflow-hidden rounded-[4px] border border-line bg-line sm:grid-cols-5">
      {cells.map(([label, value, sub]) => (
        <div key={label} className="bg-surface px-4 py-2.5 text-center">
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
          <div className="text-[20px] font-medium tabular-nums">{value}</div>
          {sub && <div className="text-[12px] text-ink-subtle">{sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** "What is this segment for?" — editable in place. */
export function DescriptionEditor({ segmentId, value, canEdit }: { segmentId: string; value: string | null; canEdit: boolean }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(value ?? "");
  const [error, setError] = useState<string | null>(null);
  if (!editing)
    return (
      <div className="mt-1 flex items-start gap-1 text-[13px]">
        {value ? <span className="text-ink-muted">{value}</span> : <span className="text-ink-subtle">What is the purpose of this segment?</span>}
        {canEdit && (
          <button className="shrink-0 font-medium text-link hover:underline" onClick={() => (setText(value ?? ""), setEditing(true))}>
            {value ? <Pencil className="mt-0.5 size-3.5" aria-label="Edit description" /> : "Add description"}
          </button>
        )}
      </div>
    );
  return (
    <form
      className="mt-1 flex max-w-[640px] items-start gap-2"
      onSubmit={async (e) => {
        e.preventDefault();
        const res = await updateSegment(segmentId, { description: text });
        if (!res.ok) return setError(res.error);
        setEditing(false);
        router.refresh();
      }}
    >
      <Input autoFocus value={text} onChange={(e) => setText(e.target.value)} maxLength={500} placeholder="e.g. US SaaS companies, 50–500 employees, callable, never reached" />
      <Button type="submit" size="sm" variant="primary">
        Save
      </Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
        Cancel
      </Button>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </form>
  );
}

function useRecordSearch(object: CrmObject, open: boolean) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<RecordHit[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => searchRecords(object, q).then((r) => live && setHits(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [object, q, open]);
  return { q, setQ, hits };
}

/** Members of other segments and hand-picked records that never belong to this segment. */
export function ExclusionsDialog({
  open,
  onOpenChange,
  segmentId,
  object,
  plural,
  value,
  records,
  segments,
  onSaved,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  segmentId: string;
  object: CrmObject;
  plural: string;
  value: SegmentExclusions;
  records: RecordHit[];
  segments: SegmentSummary[];
  onSaved: (message: string) => void;
}) {
  const router = useRouter();
  const [segs, setSegs] = useState<string[]>(value.segments);
  const [recs, setRecs] = useState<RecordHit[]>(records);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { q, setQ, hits } = useRecordSearch(object, open);
  useEffect(() => {
    if (!open) return;
    setSegs(value.segments);
    setRecs(records);
    setError(null);
  }, [open, value.segments, records]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title={`Exclude ${plural}`} className="w-[560px]">
        <div className="space-y-4 px-6 py-5 text-[13px]">
          <p className="text-ink-muted">Excluded {plural} are never in this segment, even when they match its filters or were added to it.</p>
          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-danger">{error}</p>}
          <section>
            <div className="mb-1 flex items-center justify-between">
              <h3 className="font-semibold">Members of a segment</h3>
              <span className="text-[12px] text-ink-subtle">{segs.length}/10</span>
            </div>
            <div className="thin-scroll max-h-[180px] overflow-y-auto rounded-[3px] border border-line">
              {segments.map((s) => (
                <label key={s.id} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 hover:bg-surface-hover">
                  <Checkbox
                    checked={segs.includes(s.id)}
                    disabled={!segs.includes(s.id) && segs.length >= 10}
                    onCheckedChange={(c) => setSegs((x) => (c ? [...x, s.id] : x.filter((id) => id !== s.id)))}
                  />
                  <span className="truncate">{s.name}</span>
                  <span className="ml-auto text-[12px] text-ink-subtle">{s.type === "ACTIVE" ? "Active" : "Static"}</span>
                </label>
              ))}
              {!segments.length && <p className="px-3 py-2 text-ink-subtle">No other {plural} segments yet.</p>}
            </div>
          </section>
          <section>
            <h3 className="mb-1 font-semibold">Individual {plural}</h3>
            <div className="mb-1.5 flex flex-wrap gap-1">
              {recs.map((r) => (
                <span key={r.id} className="flex items-center gap-1 rounded-full border border-line bg-surface-muted py-0.5 pl-2.5 pr-1">
                  {r.name}
                  <button onClick={() => setRecs((x) => x.filter((y) => y.id !== r.id))} className="rounded-full p-0.5 hover:bg-surface-hover" aria-label={`Stop excluding ${r.name}`}>
                    <X className="size-3" />
                  </button>
                </span>
              ))}
              {!recs.length && <span className="text-ink-subtle">None</span>}
            </div>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${plural} to exclude`} className="pl-8" />
            </div>
            {q && (
              <div className="thin-scroll mt-1 max-h-[160px] overflow-y-auto rounded-[3px] border border-line">
                {hits
                  .filter((h) => !recs.some((r) => r.id === h.id))
                  .map((h) => (
                    <button key={h.id} className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover" onClick={() => setRecs((x) => [...x, h])}>
                      <Plus className="size-3.5 text-link" />
                      <span className="truncate">{h.name}</span>
                      {h.subtitle && <span className="truncate text-[12px] text-ink-subtle">{h.subtitle}</span>}
                    </button>
                  ))}
                {!hits.length && <p className="px-3 py-2 text-ink-subtle">No matches</p>}
              </div>
            )}
          </section>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button
              variant="primary"
              disabled={saving}
              onClick={async () => {
                setSaving(true);
                const res = await updateSegment(segmentId, { exclusions: { segments: segs, records: recs.map((r) => r.id) } });
                setSaving(false);
                if (!res.ok) return setError(res.error);
                onOpenChange(false);
                onSaved(segs.length || recs.length ? "Exclusions saved" : "Exclusions removed");
                router.refresh();
              }}
            >
              Save exclusions
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Pick a record and see which groups and conditions it meets, and whether an exclusion removes it. */
export function TestRecordButton({
  segmentId,
  object,
  plural,
  groups,
  isDraft,
  sources,
  users,
  segmentNames,
}: {
  segmentId: string;
  object: CrmObject;
  plural: string;
  /** The filters being tested: the saved ones, or unsaved changes when isDraft */
  groups: FilterGroup[];
  isDraft: boolean;
  sources: { defs: PropDef[]; associatedDefs: PropDef[]; relatedDefs: RelatedDefs; segDef: PropDef };
  users: UserLite[];
  segmentNames: Map<string, string>;
}) {
  const [open, setOpen] = useState(false);
  const { q, setQ, hits } = useRecordSearch(object, open);
  const [picked, setPicked] = useState<RecordHit | null>(null);
  const [report, setReport] = useState<MatchReport | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function test(r: RecordHit) {
    setPicked(r);
    setReport(null);
    setError(null);
    const res = await testSegmentMatch(segmentId, r.id, isDraft ? { groups } : undefined);
    if (!res.ok) return setError(res.error);
    setReport(res.data);
  }

  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), !o && (setPicked(null), setReport(null)))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <FlaskConical className="size-3.5" /> Test a record
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[420px] p-0">
        {!picked ? (
          <div className="p-2">
            <p className="px-1 pb-2 text-[12px] text-ink-muted">Check why a record is or isn&apos;t in this segment{isDraft ? " with the unsaved filters" : ""}.</p>
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${plural}`} className="pl-8" />
            </div>
            <div className="thin-scroll mt-1 max-h-[240px] overflow-y-auto">
              {hits.map((h) => (
                <button key={h.id} className="flex w-full flex-col px-2 py-1.5 text-left text-[13px] hover:bg-surface-hover" onClick={() => test(h)}>
                  <span className="truncate">{h.name}</span>
                  {h.subtitle && <span className="truncate text-[12px] text-ink-subtle">{h.subtitle}</span>}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="p-3 text-[13px]">
            <div className="mb-2 flex items-center gap-2">
              <span className="min-w-0 flex-1 truncate font-medium">{picked.name}</span>
              <button className="text-[12px] text-link hover:underline" onClick={() => (setPicked(null), setReport(null))}>
                Test another
              </button>
            </div>
            {error && <p className="text-danger">{error}</p>}
            {!report && !error && <p className="text-ink-subtle">Checking…</p>}
            {report && (
              <>
                <p className={cn("mb-2 flex items-center gap-1.5 rounded-[3px] px-2.5 py-1.5 font-medium", report.matches ? "bg-[#e5f8f6] text-[#00806f]" : "bg-surface-muted text-ink")}>
                  {report.matches ? <Check className="size-4" /> : <X className="size-4" />}
                  {report.matches ? "In this segment" : "Not in this segment"}
                </p>
                {report.member !== undefined && <Line ok={report.member} text={report.member ? "Added to this static segment" : "Not added to this static segment"} />}
                {report.groups.map((g, gi) => {
                  const source = groups[gi];
                  return (
                    <div key={gi} className="mt-1.5 rounded-[3px] border border-line p-2">
                      <Line ok={g.matches} text={`Group ${gi + 1} (${g.op === "OR" ? "any condition" : "all conditions"})`} bold />
                      {g.conditions.map((ok, ci) => {
                        const c = source?.conditions[ci];
                        return <Line key={ci} ok={ok} text={c ? conditionText(c, sources, users) : `Condition ${ci + 1}`} indent />;
                      })}
                    </div>
                  );
                })}
                {report.excludedBySegments.map((id) => (
                  <Line key={id} ok={false} text={`Excluded: member of ${segmentNames.get(id) ?? "another segment"}`} />
                ))}
                {report.excludedByHand && <Line ok={false} text="Excluded by hand" />}
              </>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

function conditionText(c: FilterGroup["conditions"][number], sources: { defs: PropDef[]; associatedDefs: PropDef[]; relatedDefs: RelatedDefs; segDef: PropDef }, users: UserLite[]) {
  const def = conditionDef(c, sources);
  return def ? `${conditionPrefix(c)}${def.label} ${describeCondition(def, c, users)}` : c.property;
}

function Line({ ok, text, bold, indent }: { ok: boolean; text: string; bold?: boolean; indent?: boolean }) {
  return (
    <div className={cn("flex items-start gap-1.5 py-0.5", indent && "pl-5", bold && "font-medium")}>
      {ok ? <Check className="mt-0.5 size-3.5 shrink-0 text-[#00a38d]" aria-label="Met" /> : <X className="mt-0.5 size-3.5 shrink-0 text-danger" aria-label="Not met" />}
      <span className="min-w-0">{text}</span>
    </div>
  );
}
