"use client";

import { Check, Plus, Search } from "lucide-react";
import { useMemo, useState } from "react";
import { Input, Select } from "@/components/ui/button";
import type { PropDef } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

/** Searchable, group-filterable property list (column picker, chip picker, advanced filter picker). */
export function PropertyPicker({
  defs,
  groups,
  selected,
  onPick,
  onCreate,
  exclude,
}: {
  defs: PropDef[];
  groups: { name: string; label: string }[];
  selected?: Set<string>;
  onPick: (def: PropDef) => void;
  onCreate?: () => void;
  exclude?: (d: PropDef) => boolean;
}) {
  const [q, setQ] = useState("");
  const [group, setGroup] = useState("");
  const shown = useMemo(
    () => defs.filter((d) => !exclude?.(d) && (!group || d.groupName === group) && d.label.toLowerCase().includes(q.toLowerCase())),
    [defs, q, group, exclude],
  );
  const byGroup = groups.map((g) => ({ ...g, items: shown.filter((d) => d.groupName === g.name) })).filter((g) => g.items.length);

  return (
    <div className="flex w-[300px] flex-col">
      <div className="space-y-2 border-b border-line p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-ink-subtle" />
          <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search properties" className="pl-7" />
        </div>
        <Select value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Property group">
          <option value="">All</option>
          {groups.map((g) => (
            <option key={g.name} value={g.name}>
              {g.label}
            </option>
          ))}
        </Select>
      </div>
      <div className="thin-scroll max-h-[320px] overflow-y-auto py-1">
        {byGroup.map((g) => (
          <div key={g.name}>
            <div className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{g.label}</div>
            {g.items.map((d) => {
              const on = selected?.has(d.name);
              return (
                <button
                  key={d.name}
                  onClick={() => onPick(d)}
                  className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover", on && "font-medium")}
                >
                  <span className="flex-1 truncate">{d.label}</span>
                  {!d.isBuiltIn && <span className="rounded bg-surface-muted px-1 text-[10px] text-ink-subtle">custom</span>}
                  {on && <Check className="size-3.5 text-link" />}
                </button>
              );
            })}
          </div>
        ))}
        {!byGroup.length && <div className="px-3 py-3 text-[13px] text-ink-subtle">No properties match</div>}
      </div>
      {onCreate && (
        <button onClick={onCreate} className="flex items-center gap-1.5 border-t border-line px-3 py-2.5 text-[13px] font-medium text-link hover:bg-surface-hover">
          <Plus className="size-4" /> Create new property
        </button>
      )}
    </div>
  );
}
