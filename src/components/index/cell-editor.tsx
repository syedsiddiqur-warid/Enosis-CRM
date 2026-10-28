"use client";

import { Command } from "cmdk";
import { Check, Search } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/overlays";
import { fromLocalInput, toLocalInput } from "@/lib/crm/dates";
import type { PropDef, UserLite } from "@/lib/crm/types";

/** Popover body for editing one cell. Calls onSave with the new raw value (null clears). */
export function CellEditor({ def, value, users, onSave, onCancel }: { def: PropDef; value: unknown; users: UserLite[]; onSave: (v: unknown) => void; onCancel: () => void }) {
  if (def.type === "ENUM" || def.type === "RADIO" || def.type === "USER") {
    const options =
      def.type === "USER" ? users.map((u) => ({ value: u.id, label: u.name ?? u.email, color: undefined as string | undefined })) : (def.options ?? []);
    return (
      <Command className="w-[260px]" label={`Edit ${def.label}`}>
        <div className="flex items-center gap-2 border-b border-line px-3">
          <Search className="size-3.5 text-ink-subtle" />
          <Command.Input autoFocus placeholder="Search" className="h-9 flex-1 bg-transparent text-[13px] outline-none" onKeyDown={(e) => e.key === "Escape" && onCancel()} />
        </div>
        <Command.List className="thin-scroll max-h-[260px] overflow-y-auto py-1">
          <Command.Empty className="px-3 py-2 text-[13px] text-ink-subtle">No matches</Command.Empty>
          {options.map((o) => (
            <Command.Item
              key={o.value}
              value={o.label}
              onSelect={() => onSave(o.value)}
              className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] data-[selected=true]:bg-surface-hover"
            >
              {o.color && <span className="size-2 rounded-full" style={{ background: o.color }} />}
              <span className="flex-1 truncate">{o.label}</span>
              {value === o.value && <Check className="size-3.5 text-link" />}
            </Command.Item>
          ))}
        </Command.List>
        {value !== null && value !== undefined && (
          <button className="w-full border-t border-line px-3 py-2 text-left text-[13px] text-link hover:bg-surface-hover" onClick={() => onSave(null)}>
            Clear value
          </button>
        )}
      </Command>
    );
  }
  if (def.type === "MULTI_ENUM") return <MultiEditor def={def} value={value} onSave={onSave} />;
  if (def.type === "BOOLEAN") {
    return (
      <div className="w-[160px] py-1">
        {[true, false].map((b) => (
          <button key={String(b)} className="flex w-full items-center justify-between px-3 py-1.5 text-[13px] hover:bg-surface-hover" onClick={() => onSave(b)}>
            {b ? "Yes" : "No"} {value === b && <Check className="size-3.5 text-link" />}
          </button>
        ))}
      </div>
    );
  }
  return <TextLikeEditor def={def} value={value} onSave={onSave} onCancel={onCancel} />;
}

function MultiEditor({ def, value, onSave }: { def: PropDef; value: unknown; onSave: (v: unknown) => void }) {
  const [sel, setSel] = useState(new Set((value as string[] | null) ?? []));
  return (
    <div className="w-[240px]">
      <div className="thin-scroll max-h-[260px] overflow-y-auto py-1">
        {(def.options ?? []).map((o) => (
          <label key={o.value} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-hover">
            <Checkbox
              checked={sel.has(o.value)}
              onCheckedChange={(c) => {
                const n = new Set(sel);
                if (c) n.add(o.value);
                else n.delete(o.value);
                setSel(n);
              }}
            />
            {o.label}
          </label>
        ))}
      </div>
      <div className="flex justify-end border-t border-line px-3 py-2">
        <Button size="sm" variant="primary" onClick={() => onSave([...sel])}>
          Save
        </Button>
      </div>
    </div>
  );
}

function TextLikeEditor({ def, value, onSave, onCancel }: { def: PropDef; value: unknown; onSave: (v: unknown) => void; onCancel: () => void }) {
  // Date-times are edited as wall-clock time in the workspace time zone
  const initial =
    def.type === "DATETIME"
      ? toLocalInput(value as string | null)
      : def.type === "DATE"
        ? (value ? String(value).slice(0, 10) : "")
        : value === null || value === undefined
          ? ""
          : String(value);
  const [v, setV] = useState(initial);
  const inputType = def.type === "NUMBER" ? "number" : def.type === "DATE" ? "date" : def.type === "DATETIME" ? "datetime-local" : def.type === "EMAIL" ? "email" : "text";
  const save = () => onSave(v === "" ? null : def.type === "DATETIME" ? fromLocalInput(v) : v);
  return (
    <div className="w-[280px] p-3">
      {def.type === "TEXTAREA" ? (
        <textarea
          autoFocus
          rows={4}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Escape") onCancel();
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) save();
          }}
          className="w-full rounded-[3px] border border-line-strong px-2.5 py-1.5 text-[13px] focus:border-link focus:outline-none"
        />
      ) : (
        <Input
          autoFocus
          type={inputType}
          value={v}
          onChange={(e) => setV(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") onCancel();
          }}
        />
      )}
      <div className="mt-2 flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="sm" variant="primary" onClick={save}>
          Save
        </Button>
      </div>
    </div>
  );
}
