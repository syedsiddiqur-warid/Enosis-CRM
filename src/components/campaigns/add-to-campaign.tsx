"use client";

import { Megaphone, Search } from "lucide-react";
import { useEffect, useState } from "react";
import { Button, Input } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { addCompaniesToCampaign, searchCampaigns } from "@/lib/crm/campaign-actions";
import type { PropOption, SegmentSummary } from "@/lib/crm/types";
import { CreateCampaignDialog } from "./campaigns-list";

/** Companies bulk-bar "Add to campaign": pick an open campaign or start a new one with the selection. */
export function AddToCampaignButton({
  ids,
  types,
  segments,
  onDone,
}: {
  ids: string[];
  types: PropOption[];
  segments: SegmentSummary[];
  onDone: (message: string, campaignId: string, addedIds: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; status: string; type: string }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchCampaigns(q);
      if (live) setResults(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q]);

  return (
    <>
      <Popover open={open} onOpenChange={(o) => (setOpen(o), o && (setQ(""), setError(null)))}>
        <PopoverTrigger asChild>
          <Button size="sm" variant="ghost" className="text-link">
            <Megaphone /> Add to campaign
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[300px] p-0">
          <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Add {ids.length} to a campaign</div>
          <div className="p-2">
            <div className="relative">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" className="pl-8" aria-label="Search campaigns" autoFocus />
            </div>
          </div>
          <div className="thin-scroll max-h-[220px] overflow-y-auto pb-1">
            {results.map((c) => (
              <button
                key={c.id}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
                onClick={async () => {
                  const res = await addCompaniesToCampaign(c.id, ids);
                  if (!res.ok) return setError(res.error);
                  setOpen(false);
                  const { added, addedIds } = res.data!;
                  onDone(`Added ${added} to ${c.name}${added < ids.length ? ` (${ids.length - added} already in it)` : ""}`, c.id, addedIds);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <span className="text-[11px] uppercase text-ink-subtle">{c.status.toLowerCase()}</span>
              </button>
            ))}
            {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No open campaigns{q ? " match" : ""}</div>}
          </div>
          {error && <p className="px-3 pb-2 text-[12px] text-danger">{error}</p>}
          <div className="border-t border-line p-2">
            <Button
              size="sm"
              variant="secondary"
              className="w-full"
              onClick={() => {
                setOpen(false);
                setCreateOpen(true);
              }}
            >
              New campaign with these {ids.length}
            </Button>
          </div>
        </PopoverContent>
      </Popover>
      <CreateCampaignDialog open={createOpen} onOpenChange={setCreateOpen} types={types} segments={segments} companyIds={ids} />
    </>
  );
}
