"use client";

import { ChevronDown, Pencil, Plus, SlidersHorizontal, Trash2, X } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import {
  RELATED_KINDS,
  RELATED_LABELS,
  SEGMENT_PROPERTY,
  isRelated,
  type CrmObject,
  type FilterCondition,
  type FilterGroup,
  type PropDef,
  type RelatedDefs,
  type RelatedKind,
  type SegmentSummary,
  type UserLite,
} from "@/lib/crm/types";
import { isActiveCondition } from "@/lib/crm/view-state";
import { cn } from "@/lib/utils";
import { FilterEditor, conditionDef, conditionPrefix, defaultCondition, describeCondition, segmentFilterDef } from "./filter-editor";
import { PropertyPicker } from "./property-picker";

interface Props {
  defs: PropDef[];
  groups: { name: string; label: string }[];
  users: UserLite[];
  chips: string[];
  quick: Record<string, FilterCondition>;
  advancedCount: number;
  onQuickChange: (property: string, c: FilterCondition | undefined) => void;
  onChipsChange: (chips: string[]) => void;
  onOpenAdvanced: () => void;
}

export function QuickFilterBar({ defs, groups, users, chips, quick, advancedCount, onQuickChange, onChipsChange, onOpenAdvanced }: Props) {
  const [editingChips, setEditingChips] = useState(false);
  const [adding, setAdding] = useState(false);
  const defMap = new Map(defs.map((d) => [d.name, d]));
  // Filters set on properties that aren't pinned chips still need to be visible
  const shown = [...chips, ...Object.keys(quick).filter((k) => !chips.includes(k) && isActiveCondition(quick[k]))];

  return (
    <div className="flex flex-wrap items-center gap-1.5 px-6 py-2">
      {shown.map((name) => {
        const def = defMap.get(name);
        if (!def) return null;
        return (
          <FilterChip
            key={name}
            def={def}
            users={users}
            condition={quick[name]}
            removable={editingChips}
            onChange={(c) => onQuickChange(name, c)}
            onRemove={() => {
              onChipsChange(chips.filter((c) => c !== name));
              onQuickChange(name, undefined);
            }}
          />
        );
      })}
      <Popover open={adding} onOpenChange={setAdding}>
        <Tooltip content="Add a filter chip">
          <PopoverTrigger asChild>
            <button className="flex size-7 items-center justify-center rounded-full border border-line-strong text-ink-muted hover:bg-surface-hover" aria-label="Add filter chip">
              <Plus className="size-3.5" />
            </button>
          </PopoverTrigger>
        </Tooltip>
        <PopoverContent>
          <PropertyPicker
            defs={defs}
            groups={groups}
            exclude={(d) => chips.includes(d.name)}
            onPick={(d) => {
              onChipsChange([...chips, d.name]);
              setAdding(false);
            }}
          />
        </PopoverContent>
      </Popover>
      <Tooltip content={editingChips ? "Done editing chips" : "Edit chips"}>
        <button
          onClick={() => setEditingChips((e) => !e)}
          className={cn("flex size-7 items-center justify-center rounded-full border text-ink-muted hover:bg-surface-hover", editingChips ? "border-link bg-[#e5f5f8] text-link" : "border-line-strong")}
          aria-label="Edit chips"
          aria-pressed={editingChips}
        >
          <Pencil className="size-3.5" />
        </button>
      </Tooltip>
      <Button variant="link" size="sm" className="ml-1 gap-1 px-1" onClick={onOpenAdvanced}>
        <SlidersHorizontal className="size-3.5" /> Advanced filters{advancedCount ? ` (${advancedCount})` : ""}
      </Button>
    </div>
  );
}

function FilterChip({
  def,
  users,
  condition,
  removable,
  onChange,
  onRemove,
}: {
  def: PropDef;
  users: UserLite[];
  condition: FilterCondition | undefined;
  removable: boolean;
  onChange: (c: FilterCondition | undefined) => void;
  onRemove: () => void;
}) {
  const [open, setOpen] = useState(false);
  const active = isActiveCondition(condition);
  const kind = def.type;
  const closeOnChange = !["ENUM", "MULTI_ENUM", "RADIO", "USER"].includes(kind);
  return (
    <div className={cn("flex h-7 items-center rounded-full border text-[13px]", active ? "border-link bg-[#e5f5f8] text-ink" : "border-line-strong bg-surface")}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="flex h-full max-w-[280px] items-center gap-1 pl-3 pr-2">
            <span className={cn("truncate", active && "font-medium")}>
              {def.label}
              {active && condition ? `: ${describeCondition(def, condition, users)}` : ""}
            </span>
            <ChevronDown className="size-3.5 shrink-0" />
          </button>
        </PopoverTrigger>
        <PopoverContent>
          <FilterEditor
            def={def}
            users={users}
            condition={condition}
            onChange={(c) => {
              onChange(c);
              if (closeOnChange) setOpen(false);
            }}
          />
        </PopoverContent>
      </Popover>
      {(removable || active) && (
        <button
          onClick={() => (removable ? onRemove() : onChange(undefined))}
          className="mr-1 rounded-full p-0.5 hover:bg-black/5"
          aria-label={removable ? `Remove ${def.label} chip` : `Clear ${def.label} filter`}
        >
          <X className="size-3.5" />
        </button>
      )}
    </div>
  );
}

// ── Advanced filters side panel: OR'ed groups of AND'ed conditions, optionally on associated objects ──

type Scope = "self" | "assoc" | RelatedKind;

const RELATED_HINTS: Record<RelatedKind, string> = {
  CALL: "All call conditions in a group must match the same logged call",
  SIGNAL: "All buying-signal conditions in a group must match the same signal",
  CAMPAIGN: "All campaign conditions in a group must match the same campaign membership",
};

export function AdvancedFiltersPanel({
  object,
  open,
  onOpenChange,
  defs,
  associatedDefs,
  relatedDefs,
  segments,
  groups,
  users,
  value,
  onChange,
  title = "All filters",
  hint = "Conditions inside a group must all match (AND). A record matches if any group matches (OR). Quick filter chips apply on top.",
}: {
  object: CrmObject;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  defs: PropDef[];
  associatedDefs: PropDef[];
  /** Fields of related rows (calls, buying signals, campaign memberships) */
  relatedDefs: RelatedDefs;
  /** Segments of this object that membership conditions can reference */
  segments: SegmentSummary[];
  groups: { name: string; label: string }[];
  users: UserLite[];
  value: FilterGroup[];
  onChange: (g: FilterGroup[]) => void;
  title?: string;
  hint?: string;
}) {
  const assocObject = object === "CONTACT" ? "COMPANY" : "CONTACT";
  const assocLabel = assocObject === "COMPANY" ? "Company" : "Contact";
  const [adding, setAdding] = useState<{ group: number; scope: Scope } | null>(null);
  const [editing, setEditing] = useState<{ group: number; index: number; condition: FilterCondition } | null>(null);
  const assocGroups = Array.from(new Map(associatedDefs.map((d) => [d.groupName, { name: d.groupName ?? "", label: d.groupLabel ?? "" }])).values());
  const segDef = segmentFilterDef(segments);

  const defFor = (c: FilterCondition) => conditionDef(c, { defs, associatedDefs, relatedDefs, segDef });
  const prefix = conditionPrefix;
  const relatedKinds = RELATED_KINDS.filter((k) => relatedDefs[k]?.length);
  const update = (gi: number, conditions: FilterCondition[]) => {
    const next = value.map((g, i) => (i === gi ? { ...g, conditions } : g)).filter((g) => g.conditions.length);
    onChange(next);
  };
  const startEditing = (gi: number, c: FilterCondition) => {
    setAdding(null);
    // The condition is inserted once it has a value (FilterEditor onChange below)
    setEditing({ group: gi, index: value[gi]?.conditions.length ?? 0, condition: c });
  };
  const addingRelated = adding && isRelated(adding.scope) ? adding.scope : null;
  const pickerDefs = adding?.scope === "assoc" ? associatedDefs.filter((d) => !d.isVirtual) : addingRelated ? (relatedDefs[addingRelated] ?? []) : defs;
  const pickerGroups =
    adding?.scope === "assoc"
      ? assocGroups
      : addingRelated
        ? [{ name: relatedDefs[addingRelated]?.[0]?.groupName ?? "", label: relatedDefs[addingRelated]?.[0]?.groupLabel ?? "" }]
        : groups;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title={title} className="w-[460px]">
        <div className="thin-scroll flex-1 space-y-3 overflow-y-auto px-6 py-5">
          <p className="text-[12px] text-ink-muted">{hint}</p>
          {[...value, { op: "AND" as const, conditions: [] }].map((g, gi) => {
            const isNew = gi === value.length;
            if (isNew && value.length && !adding) {
              return (
                <Button key="or" size="sm" onClick={() => setAdding({ group: gi, scope: "self" })}>
                  <Plus className="size-3.5" /> Add filter group (OR)
                </Button>
              );
            }
            return (
              <div key={gi}>
                {gi > 0 && <div className="mb-3 text-center text-[11px] font-semibold uppercase text-ink-subtle">or</div>}
                <div className="rounded-[4px] border border-line bg-surface-muted p-3">
                  <div className="mb-2 flex items-center justify-between text-[12px] font-semibold text-ink-muted">
                    <span>Group {gi + 1}</span>
                    {!isNew && (
                      <button onClick={() => onChange(value.filter((_, i) => i !== gi))} aria-label={`Delete group ${gi + 1}`} className="rounded p-1 hover:bg-surface-hover">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                  {g.conditions.map((c, ci) => {
                    const def = defFor(c);
                    if (!def) return null;
                    return (
                      <div key={ci}>
                        {ci > 0 && <div className="py-1 text-[11px] font-semibold uppercase text-ink-subtle">and</div>}
                        <div className="flex items-start gap-2 rounded-[3px] border border-line bg-surface px-3 py-2 text-[13px]">
                          <button className="min-w-0 flex-1 text-left" onClick={() => setEditing({ group: gi, index: ci, condition: c })}>
                            <span className="font-medium">
                              {prefix(c)}
                              {def.label}
                            </span>{" "}
                            <span className="text-ink-muted">{describeCondition(def, c, users)}</span>
                          </button>
                          <button onClick={() => update(gi, g.conditions.filter((_, i) => i !== ci))} aria-label="Remove condition" className="rounded p-0.5 hover:bg-surface-hover">
                            <X className="size-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                  <div className="mt-2 flex flex-wrap gap-x-1">
                    <Button size="sm" variant="ghost" className="text-link" onClick={() => setAdding({ group: gi, scope: "self" })}>
                      <Plus className="size-3.5" /> {g.conditions.length ? "AND" : "Add filter"}
                    </Button>
                    <Button size="sm" variant="ghost" className="text-link" onClick={() => setAdding({ group: gi, scope: "assoc" })}>
                      <Plus className="size-3.5" /> {assocLabel} property
                    </Button>
                    {relatedKinds.map((k) => (
                      <Tooltip key={k} content={RELATED_HINTS[k]}>
                        <Button size="sm" variant="ghost" className="text-link" onClick={() => setAdding({ group: gi, scope: k })}>
                          <Plus className="size-3.5" /> {k === "CALL" ? "Call activity" : RELATED_LABELS[k]}
                        </Button>
                      </Tooltip>
                    ))}
                    {segments.length > 0 && (
                      <Button size="sm" variant="ghost" className="text-link" onClick={() => startEditing(gi, { property: SEGMENT_PROPERTY, operator: "is_any_of", value: [] })}>
                        <Plus className="size-3.5" /> Segment membership
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}

          {adding && (
            <div className="rounded-[4px] border border-line">
              <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] font-semibold">
                {addingRelated ? `Choose a ${RELATED_LABELS[addingRelated].toLowerCase()} field` : `Choose a ${adding.scope === "assoc" ? `${assocLabel.toLowerCase()} ` : ""}property`}
                <button onClick={() => setAdding(null)} aria-label="Cancel" className="rounded p-0.5 hover:bg-surface-hover">
                  <X className="size-3.5" />
                </button>
              </div>
              <PropertyPicker
                defs={pickerDefs}
                groups={pickerGroups}
                onPick={(d) => {
                  const association = adding.scope === "assoc" ? (assocObject as "COMPANY" | "CONTACT") : (addingRelated ?? undefined);
                  startEditing(adding.group, { ...defaultCondition(d), ...(association ? { association } : {}) });
                }}
              />
            </div>
          )}

          {editing &&
            (() => {
              const def = defFor(editing.condition);
              if (!def) return null;
              return (
                <div className="rounded-[4px] border border-link">
                  <div className="flex items-center justify-between border-b border-line px-3 py-2 text-[12px] font-semibold">
                    {prefix(editing.condition)}
                    {def.label}
                    <button onClick={() => setEditing(null)} aria-label="Close" className="rounded p-0.5 hover:bg-surface-hover">
                      <X className="size-3.5" />
                    </button>
                  </div>
                  <FilterEditor
                    def={def}
                    users={users}
                    condition={editing.condition}
                    onChange={(c) => {
                      const g = value[editing.group] ?? { op: "AND", conditions: [] };
                      const conds = [...g.conditions];
                      if (c && isActiveCondition(c)) conds[editing.index] = { ...c, association: editing.condition.association };
                      else conds.splice(editing.index, 1);
                      const groupsNext = editing.group >= value.length ? [...value, { op: "AND" as const, conditions: conds }] : value.map((x, i) => (i === editing.group ? { ...x, conditions: conds } : x));
                      onChange(groupsNext.filter((x) => x.conditions.length));
                      if (c && isActiveCondition(c)) setEditing({ ...editing, condition: conds[editing.index] });
                      if (!c || !["ENUM", "MULTI_ENUM", "RADIO", "USER"].includes(def.type)) setEditing(null);
                    }}
                  />
                </div>
              );
            })()}
        </div>
        <div className="flex justify-between border-t border-line px-6 py-3">
          <Button variant="ghost" onClick={() => onChange([])} disabled={!value.length}>
            Clear all
          </Button>
          <Button variant="primary" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
