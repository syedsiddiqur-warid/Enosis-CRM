"use client";

import { ListPlus, Search } from "lucide-react";
import { useState, useTransition } from "react";
import { Button, Input } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { addToSegment, createSegment } from "@/lib/crm/segment-actions";
import type { CrmObject, SegmentSummary } from "@/lib/crm/types";

/** Bulk-bar "Add to segment": pick a static segment or create one from the selection. */
export function AddToSegmentButton({
  object,
  ids,
  segments,
  onDone,
}: {
  object: CrmObject;
  ids: string[];
  segments: SegmentSummary[];
  /** addedIds: records that weren't members before (what an undo should remove) */
  onDone: (message: string, segmentId: string, addedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [newName, setNewName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const staticSegments = segments.filter((s) => s.type === "STATIC" && s.name.toLowerCase().includes(q.trim().toLowerCase()));
  const activeCount = segments.filter((s) => s.type === "ACTIVE").length;

  const run = (fn: () => Promise<void>) =>
    start(async () => {
      setError(null);
      await fn();
    });

  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setQ("");
          setNewName("");
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <ListPlus /> Add to segment
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[300px] p-0">
        <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Add {ids.length} to a static segment</div>
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search segments" className="pl-8" aria-label="Search segments" autoFocus />
          </div>
        </div>
        <div className="thin-scroll max-h-[220px] overflow-y-auto pb-1">
          {staticSegments.map((s) => (
            <button
              key={s.id}
              disabled={pending}
              className="block w-full truncate px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover disabled:opacity-50"
              onClick={() =>
                run(async () => {
                  const res = await addToSegment(s.id, ids);
                  if (!res.ok) return setError(res.error);
                  setOpen(false);
                  const { added, addedIds } = res.data!;
                  onDone(`Added ${added} to ${s.name}${added < ids.length ? ` (${ids.length - added} already in it)` : ""}`, s.id, addedIds);
                })
              }
            >
              {s.name}
            </button>
          ))}
          {!staticSegments.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No static segments{q ? " match" : " yet"}</div>}
          {activeCount > 0 && <p className="px-3 pt-1 text-[11px] text-ink-subtle">Active segments update from their filters, so they aren&apos;t listed.</p>}
        </div>
        <form
          className="space-y-2 border-t border-line p-3"
          onSubmit={(e) => {
            e.preventDefault();
            run(async () => {
              const res = await createSegment(object, newName, "STATIC", [], ids);
              if (!res.ok) return setError(res.error);
              setOpen(false);
              onDone(`Created ${newName.trim()} with ${ids.length} records`, res.data!.id, ids);
            });
          }}
        >
          <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="New static segment name" aria-label="New segment name" maxLength={100} />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <Button type="submit" size="sm" variant="secondary" className="w-full" disabled={pending || !newName.trim()}>
            Create segment with selection
          </Button>
        </form>
      </PopoverContent>
    </Popover>
  );
}
