"use client";

import { ChevronDown, ChevronLeft, ChevronRight, Download, ListPlus, MinusCircle, Pencil, Plus, RefreshCw, Search, SlidersHorizontal, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useState, useTransition } from "react";
import { DataTable } from "@/components/index/data-table";
import { ViewNameDialog } from "@/components/index/dialogs";
import { conditionDef, conditionPrefix, describeCondition, segmentFilterDef } from "@/components/index/filter-editor";
import { pageNumbers } from "@/components/index/index-page";
import { PreviewDrawer } from "@/components/index/preview-drawer";
import { AdvancedFiltersPanel } from "@/components/index/quick-filters";
import { Button, Input, Select } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { updateProperty } from "@/lib/crm/actions";
import { formatDate } from "@/lib/crm/dates";
import { OBJECT_LABELS } from "@/lib/crm/defaults";
import { addToSegment, cloneSegment, convertToStatic, deleteSegment, removeFromSegment, searchSegmentCandidates, updateSegment } from "@/lib/crm/segment-actions";
import type { SegmentData } from "@/lib/crm/segment-loader";
import type { ColumnSpec, FilterCondition, FilterGroup } from "@/lib/crm/types";
import { cn, toBase64Url } from "@/lib/utils";
import { TypePill } from "./segments-list";

const PAGE_SIZES = [25, 50, 100];

interface Toast {
  message: string;
  undo?: () => Promise<void>;
}

export function SegmentDetail({ data }: { data: SegmentData }) {
  const { segment, rows, total, page, pageSize, defs, users } = data;
  const object = segment.objectType;
  const labels = OBJECT_LABELS[object];
  const isActive = segment.type === "ACTIVE";
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const [q, setQ] = useState(data.q);
  const [columns, setColumns] = useState<ColumnSpec[]>(data.columns);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  // A new active segment has no filters yet: open the editor straight away
  const [filtersOpen, setFiltersOpen] = useState(isActive && data.canEdit && !data.savedFilters.length);
  const [renameOpen, setRenameOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | "delete" | "convert">(null);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [toast, setToast] = useState<Toast | null>(null);

  useEffect(() => setQ(data.q), [data.q]);
  useEffect(() => setSelected(new Set()), [page, data.q, data.filters]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const nav = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      startTransition(() => router.push(`${pathname}?${p.toString()}`));
    },
    [sp, pathname, router],
  );

  useEffect(() => {
    if (q === data.q) return;
    const t = setTimeout(() => nav({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [q, data.q, nav]);

  const setDraft = (groups: FilterGroup[]) => nav({ f: JSON.stringify(groups) === JSON.stringify(data.savedFilters) ? null : toBase64Url(groups), page: null });

  async function saveFilters() {
    const res = await updateSegment(segment.id, { groups: data.filters });
    if (!res.ok) return setToast({ message: res.error });
    setToast({ message: "Filters saved. The segment updates automatically from now on" });
    nav({ f: null });
  }

  async function onEdit(rowId: string, property: string, value: unknown) {
    const res = await updateProperty(object, rowId, property, value);
    if (!res.ok) return res.error;
    router.refresh();
    return null;
  }

  const segDef = segmentFilterDef(data.segments);
  const defFor = (c: FilterCondition) => conditionDef(c, { defs, associatedDefs: data.associatedDefs, relatedDefs: data.relatedDefs, segDef });
  const prefix = conditionPrefix;

  const exportHref = `/api/export/${labels.plural}?segment=${segment.id}${data.q ? `&q=${encodeURIComponent(data.q)}` : ""}`;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const sortable = (p: string) => p === "name" || defs.some((d) => d.name === p && !d.isVirtual && d.type !== "MULTI_ENUM" && d.type !== "FILE");

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}

      {/* Header */}
      <div className="px-6 pb-3 pt-4">
        <Link href="/segments" className="mb-2 flex w-fit items-center gap-1 text-[13px] text-link hover:underline">
          <ChevronLeft className="size-4" /> Segments
        </Link>
        <div className="flex flex-wrap items-center gap-2">
          <h1 className="text-[22px] font-medium">{segment.name}</h1>
          {data.canEdit && (
            <Tooltip content="Rename">
              <Button size="icon-sm" variant="ghost" onClick={() => setRenameOpen(true)} aria-label="Rename segment">
                <Pencil />
              </Button>
            </Tooltip>
          )}
          <TypePill type={segment.type} />
          <span className="text-[13px] text-ink-subtle">
            {total.toLocaleString()} {total === 1 ? labels.singular : labels.plural}
            {data.dirty ? " match the draft filters" : ""}
          </span>
          <div className="ml-auto flex items-center gap-2">
            {!isActive && data.canEdit && <AddRecordsButton segmentId={segment.id} plural={labels.plural} onAdded={(m) => setToast({ message: m })} />}
            <Button variant="secondary" asChild>
              <a href={exportHref}>
                <Download /> Export
              </a>
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button>
                  Actions <ChevronDown />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem disabled={!data.canEdit} onSelect={() => setRenameOpen(true)}>
                  Rename
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={async () => {
                    const res = await cloneSegment(segment.id);
                    if (!res.ok) return setToast({ message: res.error });
                    router.push(`/segments/${res.data!.id}`);
                  }}
                >
                  Clone
                </DropdownMenuItem>
                {isActive && (
                  <DropdownMenuItem disabled={!data.canEdit || data.dirty} onSelect={() => setConfirm("convert")}>
                    Convert to static
                  </DropdownMenuItem>
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem destructive disabled={!data.canEdit} onSelect={() => setConfirm("delete")}>
                  Delete segment
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        </div>
        <div className="mt-1 text-[12px] text-ink-subtle">
          {object === "CONTACT" ? "Contact" : "Company"} segment · created by {segment.ownerName ?? "unknown"} · updated {formatDate(segment.updatedAt)}
          {!data.canEdit && " · view only"}
        </div>
      </div>

      {/* Active segments: filter summary + editor */}
      {isActive && (
        <div className="mx-6 mb-3 rounded-[4px] border border-line bg-surface-muted px-4 py-3 text-[13px]">
          <div className="mb-1.5 flex items-center gap-2">
            <span className="font-semibold">Filters</span>
            <span className="text-[12px] text-ink-subtle">Records join and leave this segment automatically</span>
            {data.canEdit && (
              <Button size="sm" variant="ghost" className="ml-auto text-link" onClick={() => setFiltersOpen(true)}>
                <SlidersHorizontal className="size-3.5" /> Edit filters
              </Button>
            )}
          </div>
          {data.filters.length ? (
            <div className="space-y-1">
              {data.filters.map((g, gi) => (
                <div key={gi} className="flex flex-wrap items-center gap-1.5">
                  {gi > 0 && <span className="mr-1 text-[11px] font-semibold uppercase text-ink-subtle">or</span>}
                  {g.conditions.map((c, ci) => {
                    const def = defFor(c);
                    return (
                      <span key={ci} className="flex items-center gap-1.5">
                        {ci > 0 && <span className="text-[11px] font-semibold uppercase text-ink-subtle">{g.op === "OR" ? "or" : "and"}</span>}
                        <span className="rounded-full border border-line bg-surface px-2.5 py-0.5">
                          <span className="font-medium">
                            {prefix(c)}
                            {def?.label ?? c.property}
                          </span>{" "}
                          <span className="text-ink-muted">{def ? describeCondition(def, c, users) : ""}</span>
                        </span>
                      </span>
                    );
                  })}
                </div>
              ))}
            </div>
          ) : (
            <p className="text-ink-muted">No filters yet. An active segment matches nothing until you add one.</p>
          )}
        </div>
      )}

      {data.dirty && (
        <div className="mx-6 mb-2 flex items-center gap-3 rounded-[3px] border border-[#f5c26b] bg-warning-soft px-3 py-1.5 text-[13px]">
          <span className="flex-1">
            Unsaved filter changes. {total.toLocaleString()} {total === 1 ? labels.singular : labels.plural} would be in this segment.
          </span>
          <Button size="sm" variant="ghost" onClick={() => nav({ f: null, page: null })}>
            Discard
          </Button>
          <Button size="sm" variant="primary" onClick={saveFilters} disabled={!data.filters.length}>
            Save filters
          </Button>
        </div>
      )}

      {/* Toolbar or bulk bar */}
      {selected.size > 0 ? (
        <div className="flex items-center gap-1 bg-[#e5f5f8] px-6 py-2.5 text-[13px]">
          <span className="mr-3 font-medium">{selected.size} selected</span>
          {!isActive && data.canEdit && (
            <Button
              size="sm"
              variant="ghost"
              className="text-danger"
              onClick={async () => {
                const ids = [...selected];
                const res = await removeFromSegment(segment.id, ids);
                if (!res.ok) return setToast({ message: res.error });
                setSelected(new Set());
                setToast({ message: `Removed ${res.data!.removed} from ${segment.name}`, undo: async () => void (await addToSegment(segment.id, ids)) });
                router.refresh();
              }}
            >
              <MinusCircle /> Remove from segment
            </Button>
          )}
          <Button size="sm" variant="ghost" className="text-link" asChild>
            <a href={`${exportHref}&ids=${[...selected].join(",")}`}>
              <Download /> Export
            </a>
          </Button>
          <Button size="sm" variant="ghost" className="ml-auto" onClick={() => setSelected(new Set())}>
            Clear selection
          </Button>
        </div>
      ) : (
        <div className="flex items-center gap-2 px-6 py-3">
          <div className="relative w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${labels.plural} in segment`} className="pl-8 pr-8" aria-label="Search segment members" />
            {q && (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink" onClick={() => setQ("")} aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            )}
          </div>
          <Link href={labels.path} className="ml-auto text-[13px] text-link hover:underline">
            Go to all {labels.plural}
          </Link>
        </div>
      )}

      <DataTable
        object={object}
        basePath={labels.path}
        rows={rows}
        defs={defs}
        groups={data.groups}
        columns={columns}
        sort={data.sort}
        users={users}
        density="comfortable"
        selected={selected}
        onSelectedChange={setSelected}
        onSort={(property, dir) => {
          const direction = dir ?? (data.sort?.property === property && data.sort.direction === "asc" ? "desc" : "asc");
          nav({ sort: `${property}:${direction}`, page: null });
        }}
        onColumnsChange={setColumns}
        onEdit={onEdit}
        onPreview={setPreviewId}
        sortable={sortable}
      />

      {/* Footer */}
      <div className="flex items-center gap-3 px-6 py-2.5 text-[13px]">
        <span className="rounded-full bg-surface-muted px-2.5 py-0.5 text-[12px] text-ink-muted">
          {total.toLocaleString()} {total === 1 ? labels.singular : labels.plural}
        </span>
        <div className="mx-auto flex items-center gap-1">
          <Button size="sm" variant="ghost" disabled={page <= 1} onClick={() => nav({ page: String(page - 1) })}>
            <ChevronLeft /> Prev
          </Button>
          {pageNumbers(page, pageCount).map((n, i) =>
            n === null ? (
              <span key={`gap${i}`} className="px-1 text-ink-subtle">
                …
              </span>
            ) : (
              <button
                key={n}
                onClick={() => nav({ page: String(n) })}
                className={cn("h-7 min-w-7 rounded-[3px] px-1.5", n === page ? "border border-link font-medium text-link" : "hover:bg-surface-hover")}
                aria-current={n === page ? "page" : undefined}
              >
                {n}
              </button>
            ),
          )}
          <Button size="sm" variant="ghost" disabled={page >= pageCount} onClick={() => nav({ page: String(page + 1) })}>
            Next <ChevronRight />
          </Button>
          <Select value={pageSize} onChange={(e) => nav({ size: e.target.value, page: null })} className="ml-2 h-7 w-auto" aria-label="Rows per page">
            {PAGE_SIZES.map((s) => (
              <option key={s} value={s}>
                {s} per page
              </option>
            ))}
          </Select>
        </div>
        <Tooltip content="Refresh">
          <Button size="icon-sm" variant="ghost" onClick={() => startTransition(() => router.refresh())} aria-label="Refresh">
            <RefreshCw />
          </Button>
        </Tooltip>
      </div>

      {/* Overlays */}
      {isActive && (
        <AdvancedFiltersPanel
          object={object}
          open={filtersOpen}
          onOpenChange={setFiltersOpen}
          defs={defs}
          associatedDefs={data.associatedDefs}
          relatedDefs={data.relatedDefs}
          segments={data.segments}
          groups={data.groups}
          users={users}
          value={data.filters}
          onChange={setDraft}
          title="Segment filters"
          hint="Records that match any group join the segment. Conditions inside a group must all match. Changes preview in the table; save them to apply."
        />
      )}
      <ViewNameDialog
        open={renameOpen}
        onOpenChange={setRenameOpen}
        title="Rename segment"
        nameLabel="Segment name"
        initialName={segment.name}
        initialVisibility={segment.visibility}
        showVisibility={false}
        onSubmit={async (name) => {
          const res = await updateSegment(segment.id, { name });
          if (!res.ok) return res.error;
          router.refresh();
          return null;
        }}
      />
      <PreviewDrawer
        object={object}
        row={rows.find((r) => r.id === previewId) ?? null}
        basePath={labels.path}
        defs={defs}
        previewProperties={data.previewProperties}
        users={users}
        onOpenChange={(o) => !o && setPreviewId(null)}
      />
      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent title={confirm === "convert" ? "Convert to a static segment?" : `Delete ${segment.name}?`}>
          <div className="space-y-4 px-6 py-5 text-[13px]">
            <p>
              {confirm === "convert"
                ? `The ${total.toLocaleString()} ${labels.plural} that match now become fixed members. The filters are removed and the segment stops updating automatically. This can't be undone.`
                : "The records stay in the CRM. Only the segment and its member list are removed."}
            </p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirm(null)}>
                Cancel
              </Button>
              <Button
                variant={confirm === "delete" ? "danger" : "primary"}
                onClick={async () => {
                  const kind = confirm;
                  setConfirm(null);
                  if (kind === "delete") {
                    const res = await deleteSegment(segment.id);
                    if (!res.ok) return setToast({ message: res.error });
                    router.push("/segments");
                  } else {
                    const res = await convertToStatic(segment.id);
                    if (!res.ok) return setToast({ message: res.error });
                    setToast({ message: `Converted. ${res.data!.members} members kept` });
                    router.refresh();
                  }
                }}
              >
                {confirm === "convert" ? "Convert" : "Delete segment"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

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

/** Static segments: search records and add them one at a time. */
function AddRecordsButton({ segmentId, plural, onAdded }: { segmentId: string; plural: string; onAdded: (message: string) => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Awaited<ReturnType<typeof searchSegmentCandidates>>>([]);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(() => searchSegmentCandidates(segmentId, q).then((r) => live && setResults(r)), 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q, segmentId]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button variant="primary">
          <ListPlus /> Add {plural}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[340px] p-0">
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${plural} by name, email or phone`} className="pl-8" aria-label={`Search ${plural}`} autoFocus />
          </div>
        </div>
        <div className="thin-scroll max-h-[300px] overflow-y-auto pb-1">
          {results.map((r) => (
            <div key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[13px]">
              <div className="min-w-0 flex-1">
                <div className="truncate">{r.name}</div>
                {r.subtitle && <div className="truncate text-[12px] text-ink-subtle">{r.subtitle}</div>}
              </div>
              {r.isMember ? (
                <span className="text-[12px] text-ink-subtle">In segment</span>
              ) : (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-link"
                  disabled={busy === r.id}
                  onClick={async () => {
                    setBusy(r.id);
                    const res = await addToSegment(segmentId, [r.id]);
                    setBusy(null);
                    if (!res.ok) return onAdded(res.error);
                    setResults((rs) => rs.map((x) => (x.id === r.id ? { ...x, isMember: true } : x)));
                    onAdded(`Added ${r.name}`);
                    router.refresh();
                  }}
                >
                  <Plus className="size-3.5" /> Add
                </Button>
              )}
            </div>
          ))}
          {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
