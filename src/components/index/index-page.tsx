"use client";

import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  Filter,
  KanbanSquare,
  MoreVertical,
  Pencil,
  RefreshCw,
  Rows3,
  Rows4,
  Search,
  Settings2,
  Table2,
  Trash2,
  Undo2,
  UserPlus,
  X,
  Target,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
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
import {
  bulkDelete,
  bulkUpdate,
  cloneView,
  createView,
  deleteView,
  moveView,
  pinView,
  renameView,
  restoreRecords,
  saveView,
  setDefaultView,
  setViewOpen,
  updateProperty,
} from "@/lib/crm/actions";
import { AddToCampaignButton } from "@/components/campaigns/add-to-campaign";
import { CreateTasksButton } from "@/components/tasks/create-tasks-button";
import { createLeads } from "@/lib/crm/lead-actions";
import { removeFromCampaign, removePeopleFromCampaign } from "@/lib/crm/campaign-actions";
import { OBJECT_LABELS } from "@/lib/crm/defaults";
import type { IndexData } from "@/lib/crm/index-loader";
import { createSegmentFromView, removeFromSegment } from "@/lib/crm/segment-actions";
import type { ColumnSpec, FilterCondition, FilterGroup, PropDef, ViewState } from "@/lib/crm/types";
import { isActiveCondition, sameState } from "@/lib/crm/view-state";
import { cn, toBase64Url } from "@/lib/utils";
import { CellEditor } from "./cell-editor";
import { DataTable } from "./data-table";
import { CreatePropertyDialog, CreateRecordDialog, EditColumnsDialog, ViewNameDialog } from "./dialogs";
import { PreviewDrawer } from "./preview-drawer";
import { PropertyPicker } from "./property-picker";
import { AdvancedFiltersPanel, QuickFilterBar } from "./quick-filters";
import { AddToSegmentButton } from "./segment-picker";
import { ViewTabs } from "./view-tabs";
import { ViewInsightsDrawer } from "@/components/segments/insights-panel";

const PAGE_SIZES = [25, 50, 100];

interface Toast {
  message: string;
  undo?: () => Promise<void>;
}

export function IndexPage({ data }: { data: IndexData }) {
  const { object, views, activeViewId, state, rows, total, page, pageSize, defs, users } = data;
  const labels = OBJECT_LABELS[object];
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();

  const activeView = views.find((v) => v.id === activeViewId)!;
  const [q, setQ] = useState(data.q);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [showFilters, setShowFilters] = useState(true);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [insightsOpen, setInsightsOpen] = useState(false);
  const [columnsOpen, setColumnsOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(sp.get("create") === "1");
  const [propertyOpen, setPropertyOpen] = useState(false);
  const [previewId, setPreviewId] = useState<string | null>(null);
  const [density, setDensity] = useState<"comfortable" | "compact">("comfortable");
  const [toast, setToast] = useState<Toast | null>(null);
  const [lastUndo, setLastUndo] = useState<Toast | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [segmentOpen, setSegmentOpen] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    try {
      if (localStorage.getItem("crm.density") === "compact") setDensity("compact");
    } catch {}
  }, []);
  useEffect(() => setQ(data.q), [data.q]);
  useEffect(() => setSelected(new Set()), [activeViewId, page, data.q]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const nav = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      p.delete("create");
      for (const [k, v] of Object.entries(patch)) {
        if (v === null || v === "") p.delete(k);
        else p.set(k, v);
      }
      startTransition(() => router.push(`${pathname}?${p.toString()}`));
    },
    [sp, pathname, router],
  );

  const setViewState = useCallback(
    (next: ViewState) => nav({ st: sameState(next, activeView.state) ? null : toBase64Url(next), page: null }),
    [nav, activeView.state],
  );

  // Debounced search
  useEffect(() => {
    if (q === data.q) return;
    const t = setTimeout(() => nav({ q: q || null, page: null }), 300);
    return () => clearTimeout(t);
  }, [q, data.q, nav]);

  // "/" focuses search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const t = e.target as HTMLElement;
      if (e.key === "/" && !["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName) && !t.isContentEditable) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sortable = useCallback(
    (p: string) => {
      if (p === "name") return true;
      const d = defs.find((x) => x.name === p);
      return !!d && !d.isVirtual && d.type !== "MULTI_ENUM" && d.type !== "FILE";
    },
    [defs],
  );

  const activeFilterCount = Object.values(state.quick).filter(isActiveCondition).length + state.advanced.reduce((n, g) => n + g.conditions.length, 0);
  const visibleColumns = state.columns.filter((c) => c.property !== "__name");
  const nameCol = state.columns.find((c) => c.property === "__name");
  const exportHref = useMemo(() => {
    const p = new URLSearchParams(sp.toString());
    p.delete("page");
    p.delete("create");
    return `/api/export/${labels.plural}?${p.toString()}`;
  }, [sp, labels.plural]);

  // ── Handlers ──
  const onQuickChange = (property: string, c: FilterCondition | undefined) => {
    const quick = { ...state.quick };
    // Empty selections (e.g. all enum options unticked) aren't persisted as filters
    if (c && isActiveCondition(c)) quick[property] = c;
    else delete quick[property];
    setViewState({ ...state, quick });
  };
  const onSort = (property: string, dir?: "asc" | "desc") => {
    const direction = dir ?? (state.sort?.property === property && state.sort.direction === "asc" ? "desc" : "asc");
    setViewState({ ...state, sort: { property, direction } });
  };
  const onColumnsChange = (cols: ColumnSpec[]) => setViewState({ ...state, columns: cols });

  async function onEdit(rowId: string, property: string, value: unknown) {
    const before = rows.find((r) => r.id === rowId)?.values[property];
    const res = await updateProperty(object, rowId, property, value);
    if (!res.ok) return res.error;
    const def = defs.find((d) => d.name === property);
    const undo = { message: `${def?.label ?? property} updated`, undo: async () => void (await updateProperty(object, rowId, property, before ?? null)) };
    setLastUndo(undo);
    router.refresh();
    return null;
  }

  async function runUndo(t: Toast | null) {
    if (!t?.undo) return;
    await t.undo();
    setToast({ message: "Undone" });
    setLastUndo(null);
    router.refresh();
  }

  const viewActions = {
    select: (id: string) => nav({ view: id, st: null, page: null, q: null, size: null }),
    // New tabs start unfiltered; "Save as new" keeps the current filters
    create: async (name: string, vis: "PRIVATE" | "TEAM" | "EVERYONE", teamId: string | null, keepFilters = false) => {
      const res = await createView(object, name, vis, keepFilters ? state : { ...state, quick: {}, advanced: [] }, { teamId, pageSize: keepFilters ? pageSize : undefined });
      if (!res.ok) return res.error;
      nav({ view: res.data!.id, st: null, page: null, q: null, size: null });
      return null;
    },
    rename: async (id: string, name: string, vis: "PRIVATE" | "TEAM" | "EVERYONE", teamId: string | null) => {
      const res = await renameView(id, name, vis, teamId);
      if (!res.ok) return res.error;
      router.refresh();
      return null;
    },
    clone: async (id: string) => {
      // The active view clones with its unsaved changes; others as saved
      const res = await cloneView(id, id === activeViewId ? state : (views.find((v) => v.id === id)?.state ?? state));
      if (!res.ok) return setToast({ message: res.error });
      nav({ view: res.data!.id, st: null, page: null, size: null });
    },
    remove: async (id: string) => {
      const res = await deleteView(id);
      if (!res.ok) return setToast({ message: res.error });
      if (id === activeViewId) nav({ view: null, st: null, page: null, size: null });
      else router.refresh();
    },
    move: async (id: string, dir: -1 | 1) => {
      const res = await moveView(id, dir);
      if (!res.ok) return setToast({ message: res.error });
      router.refresh();
    },
    setOpen: async (id: string, open: boolean) => {
      const res = await setViewOpen(object, id, open);
      if (!res.ok) return setToast({ message: res.error });
      // Closing the active tab moves to the default view
      if (!open && id === activeViewId) nav({ view: null, st: null, page: null, size: null });
      else router.refresh();
    },
    setDefault: async (id: string | null) => {
      const res = await setDefaultView(object, id);
      if (!res.ok) return setToast({ message: res.error });
      setToast({ message: "Default view updated" });
      router.refresh();
    },
    pin: async (id: string, pinned: boolean) => {
      const res = await pinView(id, pinned);
      if (!res.ok) return setToast({ message: res.error });
      setToast({ message: pinned ? "View pinned for everyone who can see it" : "View unpinned" });
      router.refresh();
    },
  };

  async function onSaveView() {
    const res = await saveView(activeViewId, state, pageSize);
    if (!res.ok) return setToast({ message: res.error });
    setToast({ message: "View saved" });
    nav({ st: null, size: null });
  }

  async function onCreateSegment(name: string) {
    const res = await createSegmentFromView(object, name, activeView.systemKey, state);
    if (!res.ok) return res.error;
    router.push(`/segments/${res.data!.id}`);
    return null;
  }

  const previewRow = rows.find((r) => r.id === previewId) ?? null;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const otherObjects = (["CONTACT", "COMPANY", "DEAL"] as const).filter((o) => o !== object);

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}

      {/* Header row */}
      <div className="flex items-center gap-2 px-6 pb-2 pt-4">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-1.5 rounded px-1 text-[22px] font-medium capitalize hover:bg-surface-hover">
              {labels.plural} <ChevronDown className="size-5 text-ink-muted" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            {otherObjects.map((o) => (
              <DropdownMenuItem key={o} className="capitalize" onSelect={() => router.push(OBJECT_LABELS[o].path)}>
                {OBJECT_LABELS[o].plural}
              </DropdownMenuItem>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <span className="text-[13px] text-ink-subtle">
          {total.toLocaleString()} {total === 1 ? labels.singular : labels.plural}
        </span>
        <div className="ml-auto flex items-center gap-2">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon" variant="secondary" aria-label="Actions">
                <MoreVertical />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => router.push(`/import?object=${labels.plural}`)}>Import</DropdownMenuItem>
              <DropdownMenuItem asChild>
                <a href={exportHref}>Export view</a>
              </DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setColumnsOpen(true)}>Edit columns</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => setSegmentOpen(true)}>Create segment from this view</DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onSelect={() => setPropertyOpen(true)}>Create property</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/settings/properties?object=${labels.plural}`)}>Manage properties</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="primary" className="capitalize">
                Add {labels.plural} <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => setCreateOpen(true)}>Create new</DropdownMenuItem>
              <DropdownMenuItem onSelect={() => router.push(`/import?object=${labels.plural}`)}>Import</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <ViewTabs views={views} activeId={activeViewId} isAdmin={data.isAdmin} teams={data.teams} actions={viewActions} />

      {/* Toolbar or bulk-action bar */}
      {selected.size > 0 ? (
        <BulkBar
          count={selected.size}
          defs={defs}
          groups={data.groups}
          users={users}
          exportHref={`${exportHref}&ids=${[...selected].join(",")}`}
          onClear={() => setSelected(new Set())}
          onUpdate={async (prop, value) => {
            const ids = [...selected];
            const res = await bulkUpdate(object, ids, prop, value);
            if (!res.ok) return setToast({ message: res.error });
            setToast({ message: `Updated ${res.data!.updated} ${res.data!.updated === 1 ? labels.singular : labels.plural}` });
            router.refresh();
          }}
          onDelete={() => setConfirmDelete(true)}
          createTasks={
            <CreateTasksButton
              object={object}
              ids={[...selected]}
              users={users}
              types={data.taskTypes}
              priorities={data.taskPriorities}
              currentUserId={data.currentUserId}
              onDone={(message) => {
                setSelected(new Set());
                setToast({ message });
              }}
            />
          }
          addToSegment={
            <>
              <AddToSegmentButton
                object={object}
                ids={[...selected]}
                segments={data.segments}
                onDone={(message, segmentId, addedIds) => {
                  setSelected(new Set());
                  const t: Toast = addedIds.length ? { message, undo: async () => void (await removeFromSegment(segmentId, addedIds)) } : { message };
                  setToast(t);
                  if (addedIds.length) setLastUndo(t);
                  router.refresh();
                }}
              />
              {(object === "COMPANY" || object === "CONTACT") && (
                <AddToCampaignButton
                  object={object}
                  ids={[...selected]}
                  types={data.campaignTypes}
                  segments={data.segments}
                  onDone={(message, campaignId, addedIds) => {
                    setSelected(new Set());
                    const undo = object === "CONTACT" ? () => removePeopleFromCampaign(campaignId, addedIds) : () => removeFromCampaign(campaignId, addedIds);
                    const t: Toast = addedIds.length ? { message, undo: async () => void (await undo()) } : { message };
                    setToast(t);
                    if (addedIds.length) setLastUndo(t);
                    router.refresh();
                  }}
                />
              )}
              {object === "CONTACT" && (
                <Button
                  size="sm"
                  variant="ghost"
                  className="text-link"
                  onClick={async () => {
                    const res = await createLeads([...selected], { source: "Cold call" });
                    if (!res.ok) return setToast({ message: res.error });
                    setSelected(new Set());
                    const { created, skipped } = res.data!;
                    setToast({ message: `${created} ${created === 1 ? "lead" : "leads"} created${skipped ? `, ${skipped} already had an open lead` : ""}` });
                  }}
                >
                  <Target /> Create leads
                </Button>
              )}
            </>
          }
        />
      ) : (
        <div className="flex items-center gap-2 px-6 py-3">
          <div className="relative w-[260px]">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="pl-8 pr-8" aria-label={`Search ${labels.plural}`} />
            {q ? (
              <button className="absolute right-2 top-1/2 -translate-y-1/2 text-ink-subtle hover:text-ink" onClick={() => setQ("")} aria-label="Clear search">
                <X className="size-3.5" />
              </button>
            ) : (
              <kbd className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 rounded border border-line px-1 text-[11px] text-ink-subtle">/</kbd>
            )}
          </div>
          <Button variant={showFilters ? "outline" : "secondary"} onClick={() => setShowFilters((s) => !s)} aria-pressed={showFilters}>
            <Filter /> Filter{activeFilterCount ? ` (${activeFilterCount})` : ""}
          </Button>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button>
                Sort{state.sort ? `: ${state.sort.property === "name" ? "Name" : (defs.find((d) => d.name === state.sort!.property)?.label ?? "")}` : ""} <ChevronDown />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="thin-scroll max-h-[360px] overflow-y-auto">
              {[{ name: "name", label: "Name" } as Pick<PropDef, "name" | "label">, ...defs.filter((d) => sortable(d.name))].map((d) => (
                <DropdownMenuItem key={d.name} onSelect={() => onSort(d.name)} className={cn(state.sort?.property === d.name && "font-medium")}>
                  {d.label}
                  {state.sort?.property === d.name && <span className="ml-auto text-[11px] text-ink-subtle">{state.sort.direction === "asc" ? "A→Z ↑" : "Z→A ↓"}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuContent>
          </DropdownMenu>
          <div className="ml-auto flex items-center gap-1">
            <div className="flex rounded-[3px] border border-line-strong">
              <Tooltip content="Table view">
                <button className="flex h-8 w-9 items-center justify-center bg-surface-hover" aria-label="Table view" aria-pressed>
                  <Table2 className="size-4" />
                </button>
              </Tooltip>
              <Tooltip content="Board view arrives in build step 7">
                <button className="flex h-8 w-9 items-center justify-center border-l border-line-strong text-ink-subtle" aria-label="Board view" aria-disabled>
                  <KanbanSquare className="size-4" />
                </button>
              </Tooltip>
            </div>
            <Tooltip content="Edit columns">
              <Button size="icon" variant="ghost" onClick={() => setColumnsOpen(true)} aria-label="Edit columns">
                <Settings2 />
              </Button>
            </Tooltip>
            <Tooltip content={density === "compact" ? "Comfortable rows" : "Compact rows"}>
              <Button
                size="icon"
                variant="ghost"
                aria-label="Toggle row density"
                onClick={() =>
                  setDensity((d) => {
                    const n = d === "compact" ? "comfortable" : "compact";
                    try {
                      localStorage.setItem("crm.density", n);
                    } catch {}
                    return n;
                  })
                }
              >
                {density === "compact" ? <Rows3 /> : <Rows4 />}
              </Button>
            </Tooltip>
          </div>
        </div>
      )}

      {showFilters && selected.size === 0 && (
        <QuickFilterBar
          defs={defs}
          groups={data.groups}
          users={users}
          chips={state.chips}
          quick={state.quick}
          advancedCount={state.advanced.reduce((n, g) => n + g.conditions.length, 0)}
          onQuickChange={onQuickChange}
          onChipsChange={(chips) => setViewState({ ...state, chips })}
          onOpenAdvanced={() => setAdvancedOpen(true)}
          onOpenInsights={() => setInsightsOpen(true)}
        />
      )}

      {data.dirty && (
        <div className="mx-6 mb-2 flex items-center gap-3 rounded-[3px] border border-[#f5c26b] bg-warning-soft px-3 py-1.5 text-[13px]">
          <span className="flex-1">This view has unsaved changes.</span>
          <Button size="sm" variant="ghost" onClick={() => nav({ st: null, page: null })}>
            Reset
          </Button>
          <Button size="sm" variant="secondary" onClick={() => viewActions.create(`${activeView.name} (modified)`, "PRIVATE", null, true).then((e) => e && setToast({ message: e }))}>
            Save as new
          </Button>
          <Tooltip content={activeView.systemKey && !data.isAdmin ? "Only admins can change default views" : activeView.systemKey || activeView.isOwn ? "" : "Only the owner can save this view"}>
            <span>
              <Button size="sm" variant="primary" onClick={onSaveView} disabled={activeView.systemKey ? !data.isAdmin : !activeView.isOwn}>
                Save view
              </Button>
            </span>
          </Tooltip>
        </div>
      )}

      <DataTable
        object={object}
        basePath={labels.path}
        rows={rows}
        defs={defs}
        groups={data.groups}
        columns={nameCol ? [...visibleColumns, nameCol] : visibleColumns}
        sort={state.sort}
        users={users}
        density={density}
        selected={selected}
        onSelectedChange={setSelected}
        onSort={onSort}
        onColumnsChange={onColumnsChange}
        onEdit={onEdit}
        onPreview={setPreviewId}
        onCreateProperty={() => setPropertyOpen(true)}
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
        <div className="flex items-center gap-0.5">
          <Tooltip content="Refresh">
            <Button size="icon-sm" variant="ghost" onClick={() => startTransition(() => router.refresh())} aria-label="Refresh">
              <RefreshCw />
            </Button>
          </Tooltip>
          <Tooltip content="Export view (CSV)">
            <Button size="icon-sm" variant="ghost" asChild>
              <a href={exportHref} aria-label="Export view">
                <Download />
              </a>
            </Button>
          </Tooltip>
          <Tooltip content={lastUndo ? `Undo: ${lastUndo.message}` : "Nothing to undo"}>
            <span>
              <Button size="icon-sm" variant="ghost" disabled={!lastUndo} onClick={() => runUndo(lastUndo)} aria-label="Undo last edit">
                <Undo2 />
              </Button>
            </span>
          </Tooltip>
          <Tooltip content="Duplicate view">
            <Button size="icon-sm" variant="ghost" onClick={() => viewActions.clone(activeViewId)} aria-label="Duplicate view">
              <Copy />
            </Button>
          </Tooltip>
        </div>
      </div>

      {/* Overlays */}
      <ViewInsightsDrawer
        open={insightsOpen}
        onOpenChange={setInsightsOpen}
        object={object}
        systemKey={activeView.systemKey}
        state={state}
        q={data.q}
        onDrill={(c) => {
          setInsightsOpen(false);
          onQuickChange(c.property, c);
        }}
      />
      <AdvancedFiltersPanel
        object={object}
        open={advancedOpen}
        onOpenChange={setAdvancedOpen}
        defs={defs}
        associatedDefs={data.associatedDefs}
        relatedDefs={data.relatedDefs}
        segments={data.segments}
        groups={data.groups}
        users={users}
        value={state.advanced}
        onChange={(advanced: FilterGroup[]) => setViewState({ ...state, advanced })}
      />
      <ViewNameDialog
        open={segmentOpen}
        onOpenChange={setSegmentOpen}
        title="Create active segment"
        nameLabel="Segment name"
        initialName={activeView.systemKey === "all" && activeFilterCount === 0 ? "" : activeView.name}
        initialVisibility="EVERYONE"
        showVisibility={false}
        onSubmit={(name) => onCreateSegment(name)}
      />
      <EditColumnsDialog
        defs={defs}
        groups={data.groups}
        columns={visibleColumns}
        open={columnsOpen}
        onOpenChange={setColumnsOpen}
        onApply={(cols) => onColumnsChange(nameCol ? [...cols, nameCol] : cols)}
      />
      <CreateRecordDialog object={object} open={createOpen} onOpenChange={setCreateOpen} users={users} currentUserId={data.currentUserId} />
      <CreatePropertyDialog
        object={object}
        groups={data.groups}
        open={propertyOpen}
        onOpenChange={setPropertyOpen}
        onCreated={(name) => {
          setToast({ message: "Property created and added as a column" });
          onColumnsChange([...state.columns, { property: name }]);
        }}
      />
      <PreviewDrawer
        object={object}
        row={previewRow}
        basePath={labels.path}
        defs={defs}
        previewProperties={data.previewProperties}
        users={users}
        onOpenChange={(o) => !o && setPreviewId(null)}
      />
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={`Delete ${selected.size} ${selected.size === 1 ? labels.singular : labels.plural}?`}>
          <div className="space-y-4 px-6 py-5 text-[13px]">
            <p>Deleted records can be restored for 90 days. Their activities and associations are kept.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const ids = [...selected];
                  const res = await bulkDelete(object, ids);
                  setConfirmDelete(false);
                  if (!res.ok) return setToast({ message: res.error });
                  setSelected(new Set());
                  const t = { message: `Deleted ${res.data!.deleted} ${res.data!.deleted === 1 ? labels.singular : labels.plural}`, undo: async () => void (await restoreRecords(object, ids)) };
                  setToast(t);
                  setLastUndo(t);
                  router.refresh();
                }}
              >
                <Trash2 /> Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast.message}
          {toast.undo && (
            <button className="font-medium underline" onClick={() => runUndo(toast)}>
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

export function pageNumbers(page: number, count: number): (number | null)[] {
  if (count <= 7) return Array.from({ length: count }, (_, i) => i + 1);
  const set = new Set([1, count, page - 1, page, page + 1].filter((n) => n >= 1 && n <= count));
  const sorted = [...set].sort((a, b) => a - b);
  const out: (number | null)[] = [];
  sorted.forEach((n, i) => {
    if (i && n - sorted[i - 1] > 1) out.push(null);
    out.push(n);
  });
  return out;
}

function BulkBar({
  count,
  defs,
  groups,
  users,
  exportHref,
  onClear,
  onUpdate,
  onDelete,
  addToSegment,
  createTasks,
}: {
  count: number;
  defs: PropDef[];
  groups: { name: string; label: string }[];
  users: IndexData["users"];
  exportHref: string;
  onClear: () => void;
  onUpdate: (property: string, value: unknown) => Promise<void>;
  onDelete: () => void;
  addToSegment: React.ReactNode;
  createTasks: React.ReactNode;
}) {
  const [assignOpen, setAssignOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [editDef, setEditDef] = useState<PropDef | null>(null);
  const ownerDef = defs.find((d) => d.name === "ownerId");
  return (
    <div className="flex items-center gap-1 bg-[#e5f5f8] px-6 py-2.5 text-[13px]">
      <span className="mr-3 font-medium">{count} selected</span>
      {ownerDef && (
        <Popover open={assignOpen} onOpenChange={setAssignOpen}>
          <PopoverTrigger asChild>
            <Button size="sm" variant="ghost" className="text-link">
              <UserPlus /> Assign
            </Button>
          </PopoverTrigger>
          <PopoverContent>
            <CellEditor
              def={ownerDef}
              value={null}
              users={users}
              onCancel={() => setAssignOpen(false)}
              onSave={async (v) => {
                setAssignOpen(false);
                await onUpdate("ownerId", v);
              }}
            />
          </PopoverContent>
        </Popover>
      )}
      <Popover
        open={editOpen}
        onOpenChange={(o) => {
          setEditOpen(o);
          if (!o) setEditDef(null);
        }}
      >
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="text-link">
            <Pencil /> Edit
          </Button>
        </PopoverTrigger>
        <PopoverContent>
          {editDef ? (
            <div>
              <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Set {editDef.label} for {count} records</div>
              <CellEditor
                def={editDef}
                value={null}
                users={users}
                onCancel={() => setEditDef(null)}
                onSave={async (v) => {
                  setEditOpen(false);
                  setEditDef(null);
                  await onUpdate(editDef.name, v);
                }}
              />
            </div>
          ) : (
            <PropertyPicker defs={defs} groups={groups} exclude={(d) => d.isReadOnly || !!d.isVirtual} onPick={setEditDef} />
          )}
        </PopoverContent>
      </Popover>
      {addToSegment}
      {createTasks}
      <Button size="sm" variant="ghost" className="text-link" asChild>
        <a href={exportHref}>
          <Download /> Export
        </a>
      </Button>
      <Button size="sm" variant="ghost" className="text-danger" onClick={onDelete}>
        <Trash2 /> Delete
      </Button>
      <Button size="sm" variant="ghost" className="ml-auto" onClick={onClear}>
        Clear selection
      </Button>
    </div>
  );
}
