"use client";

// Company-level tracking cards for the record page's right column: lead journey, buying signals, campaigns.
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { Pill } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import { addCompaniesToCampaign, searchCampaigns } from "@/lib/crm/campaign-actions";
import { addSignal, deleteSignal, moveJourneyStage } from "@/lib/crm/company-actions";
import { formatDate, friendlyDateTime } from "@/lib/crm/dates";
import { STAGE } from "@/lib/crm/journey";
import type { LayoutConfig } from "@/lib/crm/record-types";
import { cn } from "@/lib/utils";
import { useRecord } from "./record-context";
import { RecordCard } from "./record-ui";

type CardConfig = LayoutConfig["right"]["cards"][number];

const SOURCE_LABEL: Record<string, string> = {
  manual: "Moved by hand",
  sourcing: "Sourcing",
  research: "Research",
  call: "Logged call",
  meeting: "Logged meeting",
  campaign: "Campaign",
  deal: "Deal",
  import: "Import",
  enrichment: "Enrichment",
};

const daysSince = (iso: string) => Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 864e5));

export function LeadJourneyCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const [showAll, setShowAll] = useState(false);
  const j = data.journey;
  const isCompany = data.object === "COMPANY";
  const title = card.title ?? (isCompany ? "Lead journey" : "Company lead journey");

  if (!j) {
    return (
      <RecordCard id={`right:${card.id}`} title={title}>
        <p className="text-[13px] text-ink-subtle">Add a primary company to follow its lead journey.</p>
      </RecordCard>
    );
  }
  const path = j.options.filter((o) => o.kind !== "exit");
  const idx = path.findIndex((o) => o.value === j.stage);
  const current = j.options.find((o) => o.value === j.stage);
  const isExitStage = current?.kind === "exit";
  const next = !isExitStage && idx >= 0 ? path[idx + 1] : undefined;
  const userName = (id: string | null) => (id ? (data.users.find((u) => u.id === id)?.name ?? "Unknown user") : null);
  const events = showAll ? j.events : j.events.slice(0, 5);

  return (
    <RecordCard id={`right:${card.id}`} title={title} actions={<MoveStage />}>
      {!isCompany && (
        <Link href={`/companies/${j.companyId}`} className="mb-2 block truncate text-[13px] text-link hover:underline">
          {j.companyName}
        </Link>
      )}
      <div className="flex items-center gap-2">
        {j.stage ? <Pill label={j.stage} color={current?.color} /> : <span className="text-[13px] text-ink-subtle">No stage yet</span>}
        {j.stageAt && <span className="text-[12px] text-ink-subtle">for {daysSince(j.stageAt)} days</span>}
      </div>
      <div className="mt-2.5 flex gap-0.5" aria-label={`Stage ${idx + 1} of ${path.length}`}>
        {path.map((o, i) => (
          <Tooltip key={o.value} content={o.label}>
            <span className={cn("h-1.5 flex-1 rounded-full", isExitStage ? "bg-[#f2545b]/30" : i <= idx ? "" : "bg-surface-muted")} style={!isExitStage && i <= idx ? { background: o.color ?? "#00a4bd" } : undefined} />
          </Tooltip>
        ))}
      </div>
      <div className="mt-1 text-[12px] text-ink-muted">
        {isExitStage ? "Left the journey (exit stage)" : idx >= 0 ? `Stage ${idx + 1} of ${path.length}${next ? ` · next: ${next.label}` : ""}` : ""}
      </div>
      {isCompany && j.stage && SALES_DECISION_STAGES.includes(j.stage) && <WonLost />}

      {j.events.length > 0 && (
        <ol className="mt-3 space-y-2.5 border-l-2 border-line pl-3">
          {events.map((e) => (
            <li key={e.id} className="relative text-[12px]">
              <span className="absolute -left-[17px] top-1 size-2 rounded-full" style={{ background: j.options.find((o) => o.value === e.to)?.color ?? "#cbd6e2" }} />
              <div className="text-[13px]">
                <span className="font-medium">{e.to}</span>
                {e.from && <span className="text-ink-subtle"> from {e.from}</span>}
              </div>
              <div className="text-ink-subtle">
                {friendlyDateTime(e.at)} · {SOURCE_LABEL[e.source] ?? e.source}
                {userName(e.userId) ? ` · ${userName(e.userId)}` : ""}
                {e.campaign ? ` · ${e.campaign}` : ""}
              </div>
              {e.reason && <div className="text-ink-muted">{e.reason}</div>}
            </li>
          ))}
        </ol>
      )}
      {j.events.length > 5 && (
        <button className="mt-2 text-[13px] text-link hover:underline" onClick={() => setShowAll((s) => !s)}>
          {showAll ? "Show less" : `Full journey (${j.events.length} steps)`}
        </button>
      )}
    </RecordCard>
  );
}

/** Stages where sales decides the outcome: a conversation, a meeting or an opportunity */
const SALES_DECISION_STAGES: string[] = [STAGE.connected, STAGE.meeting, STAGE.opportunity];

/** Close the journey: the company signed (Client), or sales lost it (with a reason). */
function WonLost() {
  const { data, toast, refresh } = useRecord();
  const j = data.journey!;
  const [losing, setLosing] = useState(false);
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const lostStage = STAGE.disqualified;
  async function move(stage: string, why: string, message: string) {
    setBusy(true);
    setError(null);
    const res = await moveJourneyStage(j.companyId, stage, why);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    toast({ message });
    refresh();
  }
  return (
    <div className="mt-2.5 rounded-[4px] border border-line bg-surface-muted p-2 text-[13px]">
      {losing ? (
        <div className="space-y-1.5">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why was it lost? e.g. went with another vendor" aria-label="Why it was lost" autoFocus />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!reason.trim() || busy} onClick={() => void move(lostStage, reason.trim(), "Marked lost")}>
              Mark lost
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setLosing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-auto text-[12px] text-ink-muted">Outcome</span>
          <Button size="sm" variant="primary" disabled={busy} onClick={() => void move(STAGE.customer, "Signed: became a client", `${j.companyName} is now a client`)}>
            Mark as client
          </Button>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => setLosing(true)}>
            Mark lost
          </Button>
        </div>
      )}
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

function MoveStage() {
  const { data, toast, refresh } = useRecord();
  const j = data.journey!;
  const [open, setOpen] = useState(false);
  const [stage, setStage] = useState(j.stage ?? "");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const exit = j.options.find((o) => o.value === stage)?.kind === "exit";
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && (setStage(j.stage ?? ""), setReason(""), setError(null)))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          Move
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] space-y-2 p-3">
        <div className="text-[12px] font-semibold">Move {data.object === "COMPANY" ? "this company" : j.companyName} to</div>
        <Select value={stage} onChange={(e) => setStage(e.target.value)} aria-label="Journey stage">
          <optgroup label="Journey">
            {j.options
              .filter((o) => o.kind !== "exit")
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
          <optgroup label="Exit stages">
            {j.options
              .filter((o) => o.kind === "exit")
              .map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
          </optgroup>
        </Select>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={exit ? "Reason (required)" : "Reason (optional)"} aria-label="Reason" />
        {error && <p className="text-[12px] text-danger">{error}</p>}
        <div className="flex justify-end">
          <Button
            size="sm"
            variant="primary"
            disabled={!stage || stage === j.stage || (exit && !reason.trim())}
            onClick={async () => {
              const res = await moveJourneyStage(j.companyId, stage, reason);
              if (!res.ok) return setError(res.error);
              setOpen(false);
              toast({ message: `Moved to ${stage}` });
              refresh();
            }}
          >
            Move
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export function SignalsCard({ card }: { card: CardConfig }) {
  const { data, toast, refresh } = useRecord();
  const [showAll, setShowAll] = useState(false);
  const limit = card.limit ?? 5;
  const shown = showAll ? data.signals : data.signals.slice(0, limit);
  const color = (type: string) => data.signalOptions.type.find((o) => o.value === type)?.color;
  const now = Date.now();

  return (
    <RecordCard id={`right:${card.id}`} title={card.title ?? "Buying signals"} count={data.signals.length} actions={<AddSignal />}>
      <ul className="space-y-2.5">
        {shown.map((s) => {
          const expired = s.expiresAt && new Date(s.expiresAt).getTime() < now;
          return (
            <li key={s.id} className={cn("group rounded-[4px] border border-line p-2.5 text-[13px]", expired && "opacity-60")}>
              <div className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <Pill label={s.type} color={color(s.type)} />
                  <div className="mt-1">
                    {s.url ? (
                      <a href={s.url} target="_blank" rel="noreferrer" className="text-link hover:underline">
                        {s.title} <ExternalLink className="inline size-3" />
                      </a>
                    ) : (
                      s.title
                    )}
                  </div>
                  {s.detail && <p className="text-[12px] text-ink-muted">{s.detail}</p>}
                  <div className="mt-0.5 text-[12px] text-ink-subtle">
                    {s.strength} · {s.source} · {formatDate(s.detectedAt)}
                    {expired ? " · expired" : ""}
                  </div>
                </div>
                <button
                  className="rounded p-1 text-ink-subtle opacity-0 hover:bg-surface-hover group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Delete signal ${s.title}`}
                  onClick={async () => {
                    const res = await deleteSignal(s.id);
                    if (!res.ok) return toast({ message: res.error });
                    const { companyId, ...input } = res.data!;
                    toast({ message: "Signal deleted", undo: async () => void (await addSignal(companyId, input)) });
                    refresh();
                  }}
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            </li>
          );
        })}
      </ul>
      {!data.signals.length && <p className="text-[13px] text-ink-subtle">No buying signals yet. Log funding, hiring, leadership changes and other reasons to call now.</p>}
      {data.signals.length > limit && (
        <button className="mt-2 text-[13px] text-link hover:underline" onClick={() => setShowAll((v) => !v)}>
          {showAll ? "Show less" : `View all signals (${data.signals.length})`}
        </button>
      )}
    </RecordCard>
  );
}

function AddSignal() {
  const { data, toast, refresh } = useRecord();
  const [open, setOpen] = useState(false);
  const blank = { type: data.signalOptions.type[0]?.value ?? "", title: "", source: "Manual research", strength: "Medium", detectedAt: new Date().toISOString().slice(0, 10), url: "", detail: "" };
  const [f, setF] = useState(blank);
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.value });
  return (
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && (setF(blank), setError(null)))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <Plus /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[320px] p-0">
        <form
          className="space-y-2 p-3"
          onSubmit={async (e) => {
            e.preventDefault();
            const res = await addSignal(data.id, { ...f, url: f.url || null, detail: f.detail || null });
            if (!res.ok) return setError(res.error);
            setOpen(false);
            toast({ message: "Buying signal added" });
            refresh();
          }}
        >
          <div className="text-[12px] font-semibold">Log a buying signal</div>
          <Select value={f.type} onChange={set("type")} aria-label="Signal type">
            {data.signalOptions.type.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
          <Input value={f.title} onChange={set("title")} placeholder="What happened, e.g. Series B – $20M" aria-label="Signal" autoFocus maxLength={200} />
          <div className="grid grid-cols-2 gap-2">
            <Select value={f.source} onChange={set("source")} aria-label="Source">
              {data.signalOptions.source.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
            <Select value={f.strength} onChange={set("strength")} aria-label="Strength">
              {data.signalOptions.strength.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </div>
          <Input type="date" value={f.detectedAt} onChange={set("detectedAt")} aria-label="Signal date" />
          <Input value={f.url} onChange={set("url")} placeholder="Link (job post, article…)" aria-label="Link" />
          <Input value={f.detail} onChange={set("detail")} placeholder="Notes (optional)" aria-label="Notes" />
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end">
            <Button type="submit" size="sm" variant="primary" disabled={!f.title.trim()}>
              Add signal
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

export function CampaignsCard({ card }: { card: CardConfig }) {
  const { data, toast, refresh } = useRecord();
  const companyId = data.journey?.companyId ?? null;
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? (data.object === "COMPANY" ? "Campaigns" : "Company campaigns")}
      count={data.campaigns.length}
      actions={
        companyId ? (
          <AddToCampaign
            onPick={async (id, name) => {
              const res = await addCompaniesToCampaign(id, [companyId]);
              if (!res.ok) return toast({ message: res.error });
              toast({ message: res.data!.added ? `Added to ${name}` : `Already in ${name}` });
              refresh();
            }}
          />
        ) : null
      }
    >
      <ul className="space-y-2">
        {data.campaigns.slice(0, card.limit ?? 5).map((c) => (
          <li key={c.campaignId} className="rounded-[4px] border border-line p-2.5 text-[13px]">
            <div className="flex items-center gap-2">
              <Link href={`/campaigns/${c.campaignId}`} className="min-w-0 flex-1 truncate font-medium text-link hover:underline">
                {c.name}
              </Link>
              {c.campaignStatus !== "ACTIVE" && <span className="text-[11px] uppercase text-ink-subtle">{c.campaignStatus.toLowerCase()}</span>}
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-ink-muted">
              <Pill label={c.status} />
              <span>
                {c.attempts} call{c.attempts === 1 ? "" : "s"}
                {c.connects ? `, ${c.connects} connected` : ""}
              </span>
              {c.lastResult && <span>Last: {c.lastResult}</span>}
            </div>
            <div className="mt-0.5 text-[12px] text-ink-subtle">
              {c.assignedTo ? `Caller: ${c.assignedTo.name}` : "No caller assigned"}
              {c.nextActionAt ? ` · next ${formatDate(c.nextActionAt)}` : ""}
            </div>
          </li>
        ))}
      </ul>
      {!data.campaigns.length && <p className="text-[13px] text-ink-subtle">{companyId ? "Not in any campaign yet." : "Add a primary company to see its campaigns."}</p>}
    </RecordCard>
  );
}

function AddToCampaign({ onPick }: { onPick: (id: string, name: string) => void }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; status: string }[]>([]);
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
    <Popover open={open} onOpenChange={(o) => (setOpen(o), o && setQ(""))}>
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <Plus /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[280px] p-0">
        <div className="p-2">
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search campaigns" autoFocus aria-label="Search campaigns" />
        </div>
        <div className="thin-scroll max-h-[240px] overflow-y-auto pb-1">
          {results.map((r) => (
            <button
              key={r.id}
              className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
              onClick={() => {
                setOpen(false);
                onPick(r.id, r.name);
              }}
            >
              <span className="min-w-0 flex-1 truncate">{r.name}</span>
              <span className="text-[11px] uppercase text-ink-subtle">{r.status.toLowerCase()}</span>
            </button>
          ))}
          {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No open campaigns</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}
