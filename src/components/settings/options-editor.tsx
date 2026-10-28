"use client";

import { ArrowDown, ArrowUp, Archive, ArchiveRestore, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { Button, Input } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import type { PropOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

const PALETTE = ["#00bda5", "#00a4bd", "#6a78d1", "#e3459b", "#ff8f59", "#f5c26b", "#f2545b", "#0e7c6b", "#7c98b6", "#cbd6e2"];

/** Edit dropdown options: rename, recolor, reorder, add, and archive (existing options are never deleted,
 *  so records that use them keep their value). `saved` lists the values already stored in the database. */
export function OptionsEditor({ options, saved, onChange, disabled }: { options: PropOption[]; saved: Set<string>; onChange: (o: PropOption[]) => void; disabled?: boolean }) {
  const [draft, setDraft] = useState("");
  const set = (i: number, patch: Partial<PropOption>) => onChange(options.map((o, j) => (j === i ? { ...o, ...patch } : o)));
  const move = (i: number, d: -1 | 1) => {
    const next = [...options];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    onChange(next);
  };
  function add() {
    const label = draft.trim();
    if (!label) return;
    onChange([...options, { value: label, label, color: PALETTE[options.length % PALETTE.length], order: options.length }]);
    setDraft("");
  }

  return (
    <div className="space-y-1">
      {options.map((o, i) => {
        const isSaved = saved.has(o.value);
        return (
          <div key={`${o.value}-${i}`} className={cn("flex items-center gap-1.5", o.archived && "opacity-55")}>
            <input
              type="color"
              value={o.color ?? "#cbd6e2"}
              disabled={disabled}
              onChange={(e) => set(i, { color: e.target.value })}
              className="size-7 shrink-0 cursor-pointer rounded border border-line bg-surface p-0.5"
              aria-label={`Color for ${o.label}`}
            />
            <Input
              value={o.label}
              disabled={disabled}
              onChange={(e) => set(i, { label: e.target.value, ...(isSaved ? {} : { value: e.target.value }) })}
              className="h-8 flex-1"
              aria-label={`Label for option ${i + 1}`}
            />
            {o.kind === "exit" && <span className="text-[11px] text-ink-subtle">exit stage</span>}
            {isSaved && o.value !== o.label && (
              <Tooltip content="Internal value stored on records (doesn't change when you rename)">
                <span className="max-w-[110px] truncate font-mono text-[11px] text-ink-subtle">{o.value}</span>
              </Tooltip>
            )}
            <Button type="button" size="icon-sm" variant="ghost" disabled={disabled || i === 0} onClick={() => move(i, -1)} aria-label={`Move ${o.label} up`}>
              <ArrowUp />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={disabled || i === options.length - 1} onClick={() => move(i, 1)} aria-label={`Move ${o.label} down`}>
              <ArrowDown />
            </Button>
            {isSaved ? (
              <Tooltip content={o.archived ? "Restore" : "Archive: hidden from pickers and filters, kept on existing records"}>
                <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => set(i, { archived: !o.archived })} aria-label={`${o.archived ? "Restore" : "Archive"} ${o.label}`}>
                  {o.archived ? <ArchiveRestore /> : <Archive />}
                </Button>
              </Tooltip>
            ) : (
              <Button type="button" size="icon-sm" variant="ghost" disabled={disabled} onClick={() => onChange(options.filter((_, j) => j !== i))} aria-label={`Remove ${o.label}`}>
                <Trash2 />
              </Button>
            )}
          </div>
        );
      })}
      {!disabled && (
        <div className="flex gap-1.5 pt-1">
          <Input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add();
              }
            }}
            placeholder="New option"
            className="h-8 flex-1"
            aria-label="New option"
          />
          <Button type="button" size="sm" variant="secondary" onClick={add} disabled={!draft.trim()}>
            <Plus /> Add
          </Button>
        </div>
      )}
    </div>
  );
}
