"use client";

// Handover: put selected ready companies into a campaign (an open one, or a new one) and give them to callers.
import { Megaphone, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Input, Label, Select } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/overlays";
import { addCompaniesToCampaign, assignCallers, createCampaign, searchCampaigns } from "@/lib/crm/campaign-actions";
import type { PropOption } from "@/lib/crm/types";
import { cn } from "@/lib/utils";

type Mode = "none" | "even" | "timezone";
const CHUNK = 1000;

export function SendToCampaignDialog({
  ids,
  users,
  types,
  onClose,
  onDone,
}: {
  ids: string[];
  users: { id: string; name: string | null; email: string }[];
  types: PropOption[];
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; status: string; type: string }[]>([]);
  const [campaign, setCampaign] = useState<{ id: string; name: string } | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newType, setNewType] = useState(types[0]?.value ?? "Custom set");
  const [callers, setCallers] = useState<string[]>([]);
  const [mode, setMode] = useState<Mode>("timezone");
  const [busy, setBusy] = useState<{ done: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ id: string; name: string; added: number; per: [string, number][] } | null>(null);

  useEffect(() => {
    let live = true;
    const t = setTimeout(async () => {
      const r = await searchCampaigns(q, "COMPANY");
      if (live) setResults(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [q]);

  const assign = mode !== "none";
  const ready = (creating ? !!newName.trim() : !!campaign) && (!assign || callers.length > 0);
  const nameOf = (id: string) => users.find((u) => u.id === id)?.name ?? users.find((u) => u.id === id)?.email ?? "Caller";

  async function send() {
    setError(null);
    setBusy({ done: 0, total: ids.length });
    let target = campaign;
    if (creating) {
      const res = await createCampaign({ name: newName, type: newType, audience: "COMPANY" });
      if (!res.ok) return (setBusy(null), setError(res.error));
      target = { id: res.data!.id, name: newName.trim() };
    }
    // In chunks: a handover can be thousands of companies
    const added: string[] = [];
    for (let i = 0; i < ids.length; i += CHUNK) {
      const res = await addCompaniesToCampaign(target!.id, ids.slice(i, i + CHUNK));
      if (!res.ok) return (setBusy(null), setError(res.error));
      added.push(...res.data!.addedIds);
      setBusy({ done: Math.min(i + CHUNK, ids.length), total: ids.length });
    }
    let per: [string, number][] = [];
    if (assign && added.length) {
      const res = await assignCallers(target!.id, added, callers, mode);
      if (!res.ok) return (setBusy(null), setError(res.error));
      per = Object.entries(res.data!.perCaller);
    }
    setBusy(null);
    setResult({ id: target!.id, name: target!.name, added: added.length, per });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && !busy && (result ? onDone(`${result.added.toLocaleString()} sent to ${result.name}`) : onClose())}>
      <DialogContent title={`Send ${ids.length.toLocaleString()} ${ids.length === 1 ? "company" : "companies"} to a campaign`} className="w-[560px]">
        {result ? (
          <div className="space-y-3 px-6 py-5 text-[13px]">
            <p>
              <strong>{result.added.toLocaleString()}</strong> {result.added === 1 ? "company is" : "companies are"} now in <strong>{result.name}</strong>
              {result.added < ids.length ? ` (${(ids.length - result.added).toLocaleString()} were already in it)` : ""}.
            </p>
            {result.per.length > 0 && (
              <ul className="space-y-0.5 rounded-[4px] bg-surface-muted px-3 py-2">
                {result.per.map(([u, n]) => (
                  <li key={u} className="flex justify-between">
                    <span>{nameOf(u)}</span>
                    <span className="tabular-nums">{n.toLocaleString()}</span>
                  </li>
                ))}
              </ul>
            )}
            <div className="flex gap-2">
              <Button asChild variant="primary">
                <Link href={`/campaigns/${result.id}`}>Open campaign</Link>
              </Button>
              <Button variant="secondary" onClick={() => onDone(`${result.added.toLocaleString()} sent to ${result.name}`)}>
                Back to Handover
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4 px-6 py-5 text-[13px]">
            <section>
              <div className="mb-1.5 font-semibold">1. Campaign</div>
              <div className="mb-2 flex gap-1.5">
                <Button size="sm" variant={!creating ? "primary" : "secondary"} onClick={() => setCreating(false)}>
                  Existing campaign
                </Button>
                <Button size="sm" variant={creating ? "primary" : "secondary"} onClick={() => setCreating(true)}>
                  New campaign
                </Button>
              </div>
              {creating ? (
                <div className="grid grid-cols-[1fr_170px] gap-2">
                  <Input value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="e.g. US Healthcare – Nov" aria-label="Campaign name" autoFocus />
                  <Select value={newType} onChange={(e) => setNewType(e.target.value)} aria-label="Campaign type">
                    {types.map((t) => (
                      <option key={t.value} value={t.value}>
                        {t.label}
                      </option>
                    ))}
                  </Select>
                </div>
              ) : (
                <>
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
                    <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search open company campaigns" className="pl-8" aria-label="Search campaigns" />
                  </div>
                  <div className="thin-scroll mt-1 max-h-[160px] overflow-y-auto rounded-[4px] border border-line">
                    {results.map((c) => (
                      <button
                        key={c.id}
                        onClick={() => setCampaign({ id: c.id, name: c.name })}
                        className={cn("flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-surface-hover", campaign?.id === c.id && "bg-[#e5f5f8] font-medium")}
                      >
                        <Megaphone className="size-3.5 text-ink-subtle" />
                        <span className="min-w-0 flex-1 truncate">{c.name}</span>
                        <span className="text-[11px] uppercase text-ink-subtle">{c.status.toLowerCase()}</span>
                      </button>
                    ))}
                    {!results.length && <div className="px-3 py-2 text-ink-subtle">No open company campaigns{q ? " match" : ""}. Create a new one instead.</div>}
                  </div>
                </>
              )}
            </section>

            <section>
              <div className="mb-1.5 font-semibold">2. Callers</div>
              <div className="mb-2 space-y-1">
                {(
                  [
                    ["timezone", "By time zone", "Each time zone goes to one caller, so everyone calls within one set of business hours"],
                    ["even", "Spread evenly", "Companies are dealt out in turn, longest waiting first"],
                    ["none", "Leave unassigned", "Callers pick them up from Unassigned in Prospecting"],
                  ] as const
                ).map(([v, label, help]) => (
                  <label key={v} className="flex cursor-pointer items-start gap-2">
                    <input type="radio" name="assign-mode" className="mt-1 accent-[var(--link)]" checked={mode === v} onChange={() => setMode(v)} />
                    <span>
                      <span className="font-medium">{label}</span> <span className="text-ink-muted">· {help}</span>
                    </span>
                  </label>
                ))}
              </div>
              {assign && (
                <div className="thin-scroll grid max-h-[150px] grid-cols-2 gap-1 overflow-y-auto rounded-[4px] border border-line p-2">
                  {users.map((u) => (
                    <label key={u.id} className="flex cursor-pointer items-center gap-2 truncate">
                      <input
                        type="checkbox"
                        className="accent-[var(--link)]"
                        checked={callers.includes(u.id)}
                        onChange={(e) => setCallers((c) => (e.target.checked ? [...c, u.id] : c.filter((x) => x !== u.id)))}
                      />
                      <span className="truncate">{u.name ?? u.email}</span>
                    </label>
                  ))}
                </div>
              )}
            </section>

            {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-danger">{error}</p>}
            {busy && (
              <div>
                <div className="mb-1 text-ink-muted">
                  Sending {busy.done.toLocaleString()} of {busy.total.toLocaleString()}…
                </div>
                <div className="h-1.5 overflow-hidden rounded bg-surface-muted">
                  <div className="h-full bg-link transition-all" style={{ width: `${(busy.done / Math.max(1, busy.total)) * 100}%` }} />
                </div>
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Label className="mr-auto self-center text-[12px] text-ink-subtle">Joining an active campaign moves them to &ldquo;In campaign&rdquo; on their lead journey.</Label>
              <Button variant="ghost" disabled={!!busy} onClick={onClose}>
                Cancel
              </Button>
              <Button variant="primary" disabled={!ready || !!busy} onClick={() => void send()}>
                Send {ids.length.toLocaleString()}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
