"use client";

import {
  type ColumnDef,
  type ColumnSizingState,
  getCoreRowModel,
  useReactTable,
} from "@tanstack/react-table";
import { useVirtualizer } from "@tanstack/react-virtual";
import { ArrowDown, ArrowUp, ChevronDown, ChevronRight, Eye, Phone, Pin, PinOff, Plus, X } from "lucide-react";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Checkbox,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverAnchor,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/overlays";
import { getRecordPreview, type RecordPreview } from "@/lib/crm/actions";
import type { IndexRow } from "@/lib/crm/query";
import type { ColumnSpec, CrmObject, PropDef, SortSpec, UserLite } from "@/lib/crm/types";
import { cn, formatPhone, fullName } from "@/lib/utils";
import { CellEditor } from "./cell-editor";
import { PropertyPicker } from "./property-picker";
import { CompanyLogo, Pill, PropValue } from "./values";

const SELECT_W = 40;
const EXPAND_W = 32;
const NAME_W = 260;
const DEFAULT_W = 180;

export interface DataTableProps {
  object: CrmObject;
  basePath: string;
  rows: IndexRow[];
  defs: PropDef[];
  groups: { name: string; label: string }[];
  columns: ColumnSpec[];
  sort: SortSpec | null;
  users: UserLite[];
  density: "comfortable" | "compact";
  selected: Set<string>;
  onSelectedChange: (s: Set<string>) => void;
  /** Toggles direction when omitted */
  onSort: (property: string, direction?: "asc" | "desc") => void;
  onColumnsChange: (cols: ColumnSpec[]) => void;
  onEdit: (rowId: string, property: string, value: unknown) => Promise<string | null>;
  onPreview: (id: string) => void;
  /** Shows "Create new property" in the column picker when set */
  onCreateProperty?: () => void;
  sortable: (property: string) => boolean;
}

type Item = { kind: "row"; row: IndexRow } | { kind: "expanded"; row: IndexRow };

export function DataTable(props: DataTableProps) {
  const { object, rows, defs, columns, users, selected, density } = props;
  const defMap = useMemo(() => new Map(defs.map((d) => [d.name, d])), [defs]);
  const [editing, setEditing] = useState<{ rowId: string; property: string } | null>(null);
  const [overrides, setOverrides] = useState<Record<string, Record<string, unknown>>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pickerOpen, setPickerOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Server data replaced → drop optimistic values
  useEffect(() => setOverrides({}), [rows]);

  const valueOf = (row: IndexRow, property: string) => (overrides[row.id] && property in overrides[row.id] ? overrides[row.id][property] : row.values[property]);

  async function save(row: IndexRow, def: PropDef, value: unknown) {
    setEditing(null);
    setOverrides((o) => ({ ...o, [row.id]: { ...o[row.id], [def.name]: value } }));
    const err = await props.onEdit(row.id, def.name, value);
    const key = `${row.id}:${def.name}`;
    if (err) {
      setOverrides((o) => {
        const n = { ...o, [row.id]: { ...o[row.id] } };
        delete n[row.id][def.name];
        return n;
      });
      setErrors((e) => ({ ...e, [key]: err }));
      setTimeout(() => setErrors((e) => Object.fromEntries(Object.entries(e).filter(([k]) => k !== key))), 4000);
    }
  }

  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const someSelected = rows.some((r) => selected.has(r.id));

  const tableColumns = useMemo<ColumnDef<IndexRow>[]>(() => {
    const visible = columns.filter((c) => defMap.has(c.property));
    return [
      { id: "__select", size: SELECT_W, enableResizing: false },
      { id: "__expand", size: EXPAND_W, enableResizing: false },
      { id: "__name", size: columns.find((c) => c.property === "__name")?.width ?? NAME_W, minSize: 160 },
      ...visible.map((c) => ({ id: c.property, size: c.width ?? DEFAULT_W, minSize: 90, maxSize: 600 })),
      { id: "__add", size: 48, enableResizing: false },
    ];
  }, [columns, defMap]);

  const columnSizing = useMemo<ColumnSizingState>(() => Object.fromEntries(tableColumns.map((c) => [c.id!, c.size!])), [tableColumns]);

  const table = useReactTable({
    data: rows,
    columns: tableColumns,
    getCoreRowModel: getCoreRowModel(),
    getRowId: (r) => r.id,
    columnResizeMode: "onEnd",
    enableColumnResizing: true,
    state: { columnSizing },
    onColumnSizingChange: (updater) => {
      const next = typeof updater === "function" ? updater(columnSizing) : updater;
      const nameWidth = next.__name !== NAME_W ? next.__name : undefined;
      const cols = columns.filter((c) => c.property !== "__name").map((c) => ({ ...c, width: next[c.property] ?? c.width }));
      props.onColumnsChange(nameWidth ? [...cols, { property: "__name", width: nameWidth }] : cols);
    },
  });

  const items: Item[] = useMemo(() => rows.flatMap((row) => (expanded.has(row.id) ? [{ kind: "row" as const, row }, { kind: "expanded" as const, row }] : [{ kind: "row" as const, row }])), [rows, expanded]);
  const rowH = density === "compact" ? 36 : 44;
  const virtualizer = useVirtualizer({
    count: items.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => (items[i].kind === "expanded" ? 140 : rowH),
    overscan: 12,
    getItemKey: (i) => `${items[i].kind}:${items[i].row.id}`,
  });
  const vItems = virtualizer.getVirtualItems();
  const padTop = vItems[0]?.start ?? 0;
  const padBottom = vItems.length ? virtualizer.getTotalSize() - vItems[vItems.length - 1].end : 0;
  const headers = table.getHeaderGroups()[0].headers;
  const totalWidth = table.getTotalSize();
  const colCount = headers.length;

  // Frozen columns are the leading property columns flagged `frozen`; they stick after the Name column
  const dataColumns = columns.filter((c) => c.property !== "__name" && defMap.has(c.property));
  const frozenCount = dataColumns.findIndex((c) => !c.frozen) === -1 ? dataColumns.length : dataColumns.findIndex((c) => !c.frozen);
  const lefts = new Map<string, number>([
    ["__select", 0],
    ["__expand", SELECT_W],
    ["__name", SELECT_W + EXPAND_W],
  ]);
  let offset = SELECT_W + EXPAND_W + (headers.find((h) => h.id === "__name")?.getSize() ?? NAME_W);
  for (const c of dataColumns.slice(0, frozenCount)) {
    lefts.set(c.property, offset);
    offset += headers.find((h) => h.id === c.property)?.getSize() ?? DEFAULT_W;
  }
  const lastFrozen = frozenCount ? dataColumns[frozenCount - 1].property : "__name";
  const stickyLeft = (id: string) => lefts.get(id);

  function freezeThrough(property: string | null) {
    const idx = property ? dataColumns.findIndex((c) => c.property === property) : -1;
    props.onColumnsChange(
      columns.map((c) => {
        const i = dataColumns.findIndex((d) => d.property === c.property);
        if (i === -1) return c;
        const next = { ...c };
        delete next.frozen;
        return i <= idx ? { ...next, frozen: true } : next;
      }),
    );
  }

  function headerContent(id: string) {
    if (id === "__select")
      return (
        <Checkbox
          aria-label="Select all rows on this page"
          checked={allSelected ? true : someSelected ? "indeterminate" : false}
          onCheckedChange={() => {
            const n = new Set(selected);
            rows.forEach((r) => (allSelected ? n.delete(r.id) : n.add(r.id)));
            props.onSelectedChange(n);
          }}
        />
      );
    if (id === "__expand") return null;
    if (id === "__add")
      return (
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <PopoverTrigger asChild>
            <button className="flex size-6 items-center justify-center rounded-[3px] text-ink-muted hover:bg-surface-hover" aria-label="Add column">
              <Plus className="size-4" />
            </button>
          </PopoverTrigger>
          <PopoverContent align="end">
            <PropertyPicker
              defs={defs}
              groups={props.groups}
              selected={new Set(columns.map((c) => c.property))}
              onPick={(d) => {
                const has = columns.some((c) => c.property === d.name);
                props.onColumnsChange(has ? columns.filter((c) => c.property !== d.name) : [...columns, { property: d.name }]);
              }}
              onCreate={
                props.onCreateProperty &&
                (() => {
                  setPickerOpen(false);
                  props.onCreateProperty!();
                })
              }
            />
          </PopoverContent>
        </Popover>
      );
    const prop = id === "__name" ? "name" : id;
    const label = id === "__name" ? "Name" : (defMap.get(id)?.label ?? id);
    const canSort = props.sortable(prop);
    const sorted = props.sort?.property === prop ? props.sort.direction : null;
    const isFrozen = id !== "__name" && dataColumns.findIndex((c) => c.property === id) < frozenCount;
    return (
      <div className="flex min-w-0 items-center gap-1">
        <button
          className={cn("flex min-w-0 flex-1 items-center gap-1 text-left font-semibold uppercase", canSort ? "hover:text-link" : "cursor-default")}
          onClick={() => canSort && props.onSort(prop)}
          title={canSort ? `Sort by ${label}` : `${label} can't be sorted`}
        >
          <span className="truncate">{label}</span>
          {sorted === "asc" && <ArrowUp className="size-3.5 shrink-0" />}
          {sorted === "desc" && <ArrowDown className="size-3.5 shrink-0" />}
          {isFrozen && <Pin className="size-3 shrink-0 text-ink-subtle" aria-label="Frozen column" />}
        </button>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="invisible shrink-0 rounded p-0.5 hover:bg-surface-hover group-hover/th:visible data-[state=open]:visible" aria-label={`${label} column options`}>
              <ChevronDown className="size-3.5" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="normal-case tracking-normal">
            <DropdownMenuItem disabled={!canSort} onSelect={() => props.onSort(prop, "asc")}>
              <ArrowUp className="size-3.5" /> Sort ascending
            </DropdownMenuItem>
            <DropdownMenuItem disabled={!canSort} onSelect={() => props.onSort(prop, "desc")}>
              <ArrowDown className="size-3.5" /> Sort descending
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            {id !== "__name" && (
              <DropdownMenuItem onSelect={() => freezeThrough(id)}>
                <Pin className="size-3.5" /> Freeze up to this column
              </DropdownMenuItem>
            )}
            {frozenCount > 0 && (
              <DropdownMenuItem onSelect={() => freezeThrough(null)}>
                <PinOff className="size-3.5" /> Unfreeze columns
              </DropdownMenuItem>
            )}
            {id !== "__name" && (
              <DropdownMenuItem destructive onSelect={() => props.onColumnsChange(columns.filter((c) => c.property !== id))}>
                <X className="size-3.5" /> Remove column
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    );
  }

  function cellContent(row: IndexRow, id: string) {
    if (id === "__select")
      return (
        <Checkbox
          aria-label={`Select ${row.name}`}
          checked={selected.has(row.id)}
          onCheckedChange={(c) => {
            const n = new Set(selected);
            if (c) n.add(row.id);
            else n.delete(row.id);
            props.onSelectedChange(n);
          }}
        />
      );
    if (id === "__expand")
      return (
        <button
          className="flex size-6 items-center justify-center rounded-[3px] text-ink-muted hover:bg-surface-hover"
          onClick={() =>
            setExpanded((e) => {
              const n = new Set(e);
              if (n.has(row.id)) n.delete(row.id);
              else n.add(row.id);
              return n;
            })
          }
          aria-label={expanded.has(row.id) ? "Hide associations" : "Show associations"}
          aria-expanded={expanded.has(row.id)}
        >
          <ChevronRight className={cn("size-4 transition-transform", expanded.has(row.id) && "rotate-90")} />
        </button>
      );
    if (id === "__add") return null;
    if (id === "__name")
      return (
        <div className="flex min-w-0 items-center gap-2">
          {object === "COMPANY" ? (
            <CompanyLogo name={row.name} domain={row.domain} size={24} />
          ) : (
            <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-[#eaf0f6] text-[10px] font-semibold text-ink-muted">
              {row.name
                .split(" ")
                .slice(0, 2)
                .map((p) => p[0])
                .join("")
                .toUpperCase()}
            </span>
          )}
          <Link href={`${props.basePath}/${row.id}`} className="truncate font-medium text-link hover:underline">
            {row.name}
          </Link>
          <button
            onClick={() => props.onPreview(row.id)}
            className="invisible ml-auto flex shrink-0 items-center gap-1 rounded-[3px] border border-line-strong bg-surface px-2 py-0.5 text-[12px] font-medium text-ink group-hover/row:visible"
          >
            <Eye className="size-3.5" /> Preview
          </button>
        </div>
      );

    const def = defMap.get(id)!;
    if (object === "CONTACT" && id === "primaryCompany") {
      return row.primaryCompany ? (
        <Link href={`/companies/${row.primaryCompany.id}`} className="flex min-w-0 items-center gap-1.5 text-link hover:underline">
          <CompanyLogo name={row.primaryCompany.name} domain={row.primaryCompany.domain} size={20} />
          <span className="truncate">{row.primaryCompany.name}</span>
        </Link>
      ) : (
        <span className="text-ink-subtle">--</span>
      );
    }
    const value = valueOf(row, id);
    const error = errors[`${row.id}:${id}`];
    const display = (
      <span className="flex min-w-0 items-center">
        <PropValue def={def} value={value} users={users} />
      </span>
    );
    if (def.isReadOnly || def.isVirtual) return display;
    const isEditing = editing?.rowId === row.id && editing.property === id;
    return (
      <Popover open={isEditing} onOpenChange={(o) => !o && setEditing(null)}>
        <PopoverAnchor asChild>
          <div
            role="button"
            tabIndex={0}
            onClick={() => setEditing({ rowId: row.id, property: id })}
            onKeyDown={(e) => e.key === "Enter" && setEditing({ rowId: row.id, property: id })}
            className={cn("-mx-1.5 flex h-7 min-w-0 cursor-pointer items-center rounded-[3px] px-1.5 hover:bg-surface hover:ring-1 hover:ring-line-strong", error && "ring-1 ring-danger")}
            title={error ?? `Edit ${def.label}`}
          >
            {display}
          </div>
        </PopoverAnchor>
        {isEditing && (
          <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()}>
            <CellEditor def={def} value={value} users={users} onSave={(v) => save(row, def, v)} onCancel={() => setEditing(null)} />
          </PopoverContent>
        )}
      </Popover>
    );
  }

  return (
    <div ref={scrollRef} className="thin-scroll relative min-h-0 flex-1 overflow-auto border-y border-line">
      <table className="border-separate border-spacing-0 text-[13px]" style={{ width: totalWidth, tableLayout: "fixed" }}>
        <colgroup>
          {headers.map((h) => (
            <col key={h.id} style={{ width: h.getSize() }} />
          ))}
        </colgroup>
        <thead className="sticky top-0 z-20">
          <tr>
            {headers.map((h) => {
              const left = stickyLeft(h.id);
              return (
                <th
                  key={h.id}
                  className={cn(
                    "group/th relative h-10 border-b border-r border-line bg-surface-muted px-3 text-left text-[11px] tracking-wide text-ink",
                    left !== undefined && "sticky z-10",
                    h.id === lastFrozen && "shadow-[2px_0_0_var(--border)]",
                    (h.id === "__select" || h.id === "__expand") && "border-r-0 px-0 text-center [&>*]:mx-auto",
                  )}
                  style={left !== undefined ? { left } : undefined}
                >
                  {headerContent(h.id)}
                  {h.column.getCanResize() && (
                    <div
                      onMouseDown={h.getResizeHandler()}
                      onTouchStart={h.getResizeHandler()}
                      onDoubleClick={() => h.column.resetSize()}
                      className={cn("absolute -right-[3px] top-0 z-10 h-full w-[6px] cursor-col-resize", h.column.getIsResizing() && "bg-link")}
                      style={h.column.getIsResizing() ? { transform: `translateX(${table.getState().columnSizingInfo.deltaOffset ?? 0}px)` } : undefined}
                      role="separator"
                      aria-label={`Resize column`}
                    />
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {padTop > 0 && (
            <tr>
              <td colSpan={colCount} style={{ height: padTop }} />
            </tr>
          )}
          {vItems.map((vi) => {
            const item = items[vi.index];
            if (item.kind === "expanded") {
              return (
                <tr key={vi.key} data-index={vi.index} ref={virtualizer.measureElement}>
                  <td colSpan={colCount} className="border-b border-line bg-surface-muted p-0">
                    <div className="sticky left-0" style={{ width: Math.min(totalWidth, 900) }}>
                      <ExpandedAssociations object={object} id={item.row.id} />
                    </div>
                  </td>
                </tr>
              );
            }
            const row = item.row;
            const isSel = selected.has(row.id);
            return (
              <tr key={vi.key} data-index={vi.index} ref={virtualizer.measureElement} className="group/row">
                {headers.map((h) => {
                  const left = stickyLeft(h.id);
                  return (
                    <td
                      key={h.id}
                      className={cn(
                        "overflow-hidden border-b border-r border-line px-3",
                        isSel ? "bg-[#e5f5f8]" : "bg-surface group-hover/row:bg-[#f5f8fa]",
                        left !== undefined && "sticky z-10",
                        h.id === lastFrozen && "shadow-[2px_0_0_var(--border)]",
                        (h.id === "__select" || h.id === "__expand") && "border-r-0 px-0 text-center [&>*]:mx-auto",
                      )}
                      style={{ height: rowH, ...(left !== undefined ? { left } : {}) }}
                    >
                      {cellContent(row, h.id)}
                    </td>
                  );
                })}
              </tr>
            );
          })}
          {padBottom > 0 && (
            <tr>
              <td colSpan={colCount} style={{ height: padBottom }} />
            </tr>
          )}
        </tbody>
      </table>
      {!rows.length && <EmptyState />}
    </div>
  );
}

function EmptyState() {
  return (
    <div className="sticky left-0 flex flex-col items-center py-16 text-center">
      <div className="mb-1 text-[16px] font-medium">No matches for the current filters</div>
      <div className="text-[13px] text-ink-muted">Expecting to see new records? Try again in a few seconds as the system catches up.</div>
    </div>
  );
}

function ExpandedAssociations({ object, id }: { object: CrmObject; id: string }) {
  const [data, setData] = useState<RecordPreview | null>(null);
  useEffect(() => {
    let live = true;
    getRecordPreview(object, id).then((d) => live && setData(d));
    return () => {
      live = false;
    };
  }, [object, id]);
  if (!data) return <div className="px-6 py-4 text-[13px] text-ink-subtle">Loading associations…</div>;
  return (
    <div className="grid grid-cols-2 gap-6 px-6 py-3 text-[13px]">
      {object === "CONTACT" ? (
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-ink-muted">Companies ({data.companies.length})</h4>
          {data.companies.map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-0.5">
              <CompanyLogo name={c.name} domain={c.domain} size={18} />
              <Link href={`/companies/${c.id}`} className="text-link hover:underline">
                {c.name}
              </Link>
              {c.isPrimary && <Pill label="Primary" />}
              {c.labels.map((l) => (
                <Pill key={l} label={l} />
              ))}
            </div>
          ))}
          {!data.companies.length && <div className="text-ink-subtle">No companies</div>}
        </section>
      ) : (
        <section>
          <h4 className="mb-1.5 text-[12px] font-semibold text-ink-muted">Contacts ({data.contacts.length})</h4>
          {data.contacts.slice(0, 6).map((c) => (
            <div key={c.id} className="flex items-center gap-2 py-0.5">
              <Link href={`/contacts/${c.id}`} className="text-link hover:underline">
                {fullName(c)}
              </Link>
              <span className="truncate text-ink-subtle">{c.jobTitle}</span>
              {c.inDbnd?.toLowerCase() === "yes" && <Pill label="In DBND" />}
              <span className="ml-auto text-[12px] text-ink-muted">CRT {c.crtCount}</span>
            </div>
          ))}
          {!data.contacts.length && <div className="text-ink-subtle">No contacts</div>}
        </section>
      )}
      <section>
        <h4 className="mb-1.5 text-[12px] font-semibold text-ink-muted">Phone numbers ({data.phones.length})</h4>
        {data.phones.map((p) => (
          <div key={p.id} className="flex items-center gap-2 py-0.5">
            <Phone className="size-3.5 text-ink-subtle" />
            <a href={`tel:${p.number}`} className="tabular-nums text-link hover:underline">
              {formatPhone(p.number)}
            </a>
            <span className="text-ink-subtle">{p.type}</span>
            {p.ivrPath && <span className="text-[12px] text-ink-muted">{p.ivrPath}</span>}
            <Pill label={p.status} className="ml-auto" />
          </div>
        ))}
        {!data.phones.length && <div className="text-ink-subtle">No phone numbers</div>}
      </section>
    </div>
  );
}
