"use client";

import { Copy, MoreHorizontal, Phone, Plus, Search } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyLogo, LocalTime, Pill, copyText } from "@/components/index/values";
import { Button, Input } from "@/components/ui/button";
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverAnchor, PopoverContent, PopoverTrigger, Tooltip } from "@/components/ui/overlays";
import { searchCompanies } from "@/lib/crm/actions";
import { formatDate, friendlyDateTime } from "@/lib/crm/dates";
import { associate, dissociate, searchContacts, setAssociationLabels, setPrimaryCompany } from "@/lib/crm/record-actions";
import type { LayoutConfig } from "@/lib/crm/record-types";
import { cn, formatNumber, formatPhone, phoneHref } from "@/lib/utils";
import { deletePhoneNumber, savePhoneNumber, setPhoneStatus, type PhoneInput } from "@/lib/crm/phone-actions";
import { CampaignsCard, LeadJourneyCard, SignalsCard } from "./company-cards";
import { PhoneDialog } from "./phone-dialog";
import { useRecord } from "./record-context";
import { CardGear, RecordCard } from "./record-ui";

type CardConfig = LayoutConfig["right"]["cards"][number];

const PHONE_STATUS_COLORS: Record<string, string> = { Valid: "#00bda5", "Temp Busy": "#f5c26b", Wrong: "#f2545b", Disconnected: "#f2545b", Unknown: "#cbd6e2" };

export function RightColumn() {
  const { data } = useRecord();
  return (
    <aside className="thin-scroll min-h-0 overflow-y-auto rounded-[6px] border border-line bg-surface">
      {data.layout.config.right.cards.map((card) => {
        if (card.kind === "association" && card.object === "COMPANY" && data.object === "CONTACT") return <CompaniesCard key={card.id} card={card} />;
        if (card.kind === "association" && card.object === "CONTACT" && data.object === "COMPANY") return <ContactsCard key={card.id} card={card} />;
        if (card.kind === "association" && card.object === "DEAL") return <DealsCard key={card.id} card={card} />;
        if (card.kind === "phone_numbers") return <PhonesCard key={card.id} card={card} />;
        if (card.kind === "case_studies") return <ProjectsCard key={card.id} card={card} />;
        if (card.kind === "segments") return <SegmentsCard key={card.id} card={card} />;
        if (card.kind === "lead_journey") return <LeadJourneyCard key={card.id} card={card} />;
        if (card.kind === "buying_signals" && data.object === "COMPANY") return <SignalsCard key={card.id} card={card} />;
        if (card.kind === "campaigns") return <CampaignsCard key={card.id} card={card} />;
        return null;
      })}
    </aside>
  );
}

/** "View all" toggle for cards over their configured limit. */
function useLimit<T>(items: T[], limit = 5) {
  const [all, setAll] = useState(false);
  return { shown: all ? items : items.slice(0, limit), more: items.length > limit && !all ? items.length - limit : 0, showAll: () => setAll(true) };
}

function AddAssociation({ kind, onPick }: { kind: "company" | "contact"; onPick: (id: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [results, setResults] = useState<{ id: string; name: string; subtitle: string | null }[]>([]);
  useEffect(() => {
    if (!open) return;
    let live = true;
    const t = setTimeout(async () => {
      const r =
        kind === "company" ? (await searchCompanies(q)).map((c) => ({ id: c.id, name: c.name, subtitle: c.domain })) : await searchContacts(q);
      if (live) setResults(r);
    }, 200);
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, [open, q, kind]);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) setQ("");
      }}
    >
      <PopoverTrigger asChild>
        <Button size="sm" variant="ghost" className="text-link">
          <Plus /> Add
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[300px] p-0">
        <div className="p-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={`Search ${kind === "company" ? "companies" : "contacts"}`} className="pl-8" autoFocus aria-label={`Search ${kind === "company" ? "companies" : "contacts"}`} />
          </div>
        </div>
        <div className="thin-scroll max-h-[260px] overflow-y-auto pb-1">
          {results.map((r) => (
            <button
              key={r.id}
              className="block w-full px-3 py-1.5 text-left text-[13px] hover:bg-surface-hover"
              onClick={async () => {
                setOpen(false);
                await onPick(r.id);
              }}
            >
              <div className="truncate">{r.name}</div>
              {r.subtitle && <div className="truncate text-[12px] text-ink-subtle">{r.subtitle}</div>}
            </button>
          ))}
          {!results.length && <div className="px-3 py-2 text-[13px] text-ink-subtle">No matches</div>}
        </div>
      </PopoverContent>
    </Popover>
  );
}

function LabelsEditor({ labels, onSave }: { labels: string[]; onSave: (labels: string[]) => void }) {
  const { data } = useRecord();
  const [sel, setSel] = useState(new Set(labels));
  return (
    <div className="w-[220px]">
      <div className="border-b border-line px-3 py-2 text-[12px] font-semibold">Association labels</div>
      <div className="py-1">
        {data.associationLabels.map((l) => (
          <label key={l} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-hover">
            <Checkbox
              checked={sel.has(l)}
              onCheckedChange={(c) => {
                const n = new Set(sel);
                if (c) n.add(l);
                else n.delete(l);
                setSel(n);
              }}
            />
            {l}
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

function useAssociationActions() {
  const { toast, refresh } = useRecord();
  return async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) => {
    const res = await fn();
    if (!res.ok) return toast({ message: res.error });
    toast({ message });
    refresh();
  };
}

function CompaniesCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const run = useAssociationActions();
  const [labelling, setLabelling] = useState<string | null>(null);
  const { shown, more, showAll } = useLimit(data.companies, card.limit);
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? "Companies"}
      count={data.companies.length}
      actions={
        <>
          <AddAssociation kind="company" onPick={(companyId) => run(() => associate(data.id, companyId), "Company associated")} />
          <CardGear label="Card settings" />
        </>
      }
    >
      <div className="space-y-3">
        {shown.map((c) => (
          <div key={c.id} className="rounded-[4px] border border-line p-3 text-[13px]">
            <div className="flex items-start gap-2">
              <CompanyLogo name={c.name} domain={c.domain} size={28} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-1.5">
                  <Link href={`/companies/${c.id}`} className="truncate font-medium text-link hover:underline">
                    {c.name}
                  </Link>
                  {c.isPrimary && <Pill label="Primary" color="#00a4bd" />}
                  {c.labels.map((l) => (
                    <Pill key={l} label={l} />
                  ))}
                </div>
                {c.domain && (
                  <div className="group mt-0.5 flex items-center gap-1">
                    <a href={`https://${c.domain}`} target="_blank" rel="noreferrer" className="truncate text-link hover:underline">
                      {c.domain}
                    </a>
                    <button className="opacity-0 group-hover:opacity-100" onClick={() => copyText(c.domain!)} aria-label="Copy domain">
                      <Copy className="size-3.5 text-ink-subtle" />
                    </button>
                  </div>
                )}
                {c.phone && (
                  <a href={phoneHref(c.phone)} className="mt-0.5 block tabular-nums text-ink-muted hover:text-link">
                    {formatPhone(c.phone)}
                  </a>
                )}
              </div>
              <Popover open={labelling === c.id} onOpenChange={(o) => setLabelling(o ? c.id : null)}>
                <DropdownMenu>
                  <PopoverAnchor asChild>
                    <DropdownMenuTrigger asChild>
                      <Button size="icon-sm" variant="ghost" aria-label={`${c.name} association options`}>
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                  </PopoverAnchor>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem disabled={c.isPrimary} onSelect={() => run(() => setPrimaryCompany(data.id, c.id), `${c.name} is now the primary company`)}>
                      Set as primary
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setTimeout(() => setLabelling(c.id), 0)}>Edit association labels</DropdownMenuItem>
                    <DropdownMenuSeparator />
                    <DropdownMenuItem destructive onSelect={() => run(() => dissociate(data.id, c.id), `Removed ${c.name}`)}>
                      Remove association
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
                <PopoverContent align="end" className="p-0">
                  <LabelsEditor
                    labels={c.labels}
                    onSave={(labels) => {
                      setLabelling(null);
                      void run(() => setAssociationLabels(data.id, c.id, labels), "Labels updated");
                    }}
                  />
                </PopoverContent>
              </Popover>
            </div>
          </div>
        ))}
        {!data.companies.length && <p className="text-[13px] text-ink-subtle">Not associated with a company yet.</p>}
        {more > 0 && (
          <button className="text-[13px] text-link hover:underline" onClick={showAll}>
            View all associated Companies ({data.companies.length})
          </button>
        )}
      </div>
    </RecordCard>
  );
}

function ContactsCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const run = useAssociationActions();
  const [labelling, setLabelling] = useState<string | null>(null);
  const { shown, more, showAll } = useLimit(data.contacts, card.limit);
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? "Contacts"}
      count={data.contacts.length}
      actions={
        <>
          <AddAssociation kind="contact" onPick={(contactId) => run(() => associate(contactId, data.id), "Contact associated")} />
          <CardGear label="Card settings" />
        </>
      }
    >
      <ul className="divide-y divide-line">
        {shown.map((c) => (
          <li key={c.id} className="flex items-start gap-2 py-2 text-[13px] first:pt-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5">
                <Link href={`/contacts/${c.id}`} className="font-medium text-link hover:underline">
                  {c.name}
                </Link>
                {c.inDbnd?.toLowerCase() === "yes" && <Pill label="In DBND" color="#6a78d1" />}
                {c.labels.map((l) => (
                  <Pill key={l} label={l} />
                ))}
              </div>
              {c.jobTitle && <div className="text-ink-muted">{c.jobTitle}</div>}
              {c.timeZone && (
                <div className="mt-0.5 text-[12px] text-ink-muted">
                  <LocalTime tz={c.timeZone} suffix="local time" icon />
                </div>
              )}
              {c.email && (
                <a href={`mailto:${c.email}`} className="block truncate text-[12px] text-link hover:underline">
                  {c.email}
                </a>
              )}
            </div>
            <Tooltip content="Logged call attempts (CRT count)">
              <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[12px] tabular-nums text-ink-muted">CRT {c.crtCount}</span>
            </Tooltip>
            <Popover open={labelling === c.id} onOpenChange={(o) => setLabelling(o ? c.id : null)}>
              <DropdownMenu>
                <PopoverAnchor asChild>
                  <DropdownMenuTrigger asChild>
                    <Button size="icon-sm" variant="ghost" aria-label={`${c.name} association options`}>
                      <MoreHorizontal />
                    </Button>
                  </DropdownMenuTrigger>
                </PopoverAnchor>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem onSelect={() => setTimeout(() => setLabelling(c.id), 0)}>Edit association labels</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem destructive onSelect={() => run(() => dissociate(c.id, data.id), `Removed ${c.name}`)}>
                    Remove association
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
              <PopoverContent align="end" className="p-0">
                <LabelsEditor
                  labels={c.labels}
                  onSave={(labels) => {
                    setLabelling(null);
                    void run(() => setAssociationLabels(c.id, data.id, labels), "Labels updated");
                  }}
                />
              </PopoverContent>
            </Popover>
          </li>
        ))}
      </ul>
      {!data.contacts.length && <p className="text-[13px] text-ink-subtle">No contacts at this company yet.</p>}
      {more > 0 && (
        <button className="mt-1 text-[13px] text-link hover:underline" onClick={showAll}>
          View all associated Contacts ({data.contacts.length})
        </button>
      )}
    </RecordCard>
  );
}

function PhonesCard({ card }: { card: CardConfig }) {
  const { data, toast, openComposer, refresh } = useRecord();
  const { shown, more, showAll } = useLimit(data.phones, card.limit);
  const [dialog, setDialog] = useState<{ editing: (PhoneInput & { id: string }) | null } | null>(null);
  const act = async (fn: () => Promise<{ ok: true } | { ok: false; error: string }>, message: string) => {
    const res = await fn();
    if (!res.ok) return toast({ message: res.error });
    toast({ message });
    refresh();
  };
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? "Phone numbers"}
      count={data.phones.length}
      actions={
        <>
          <Button size="sm" variant="ghost" className="text-link" onClick={() => setDialog({ editing: null })}>
            <Plus /> Add
          </Button>
          <CardGear label="Card settings" />
        </>
      }
    >
      {dialog && <PhoneDialog editing={dialog.editing} onClose={() => setDialog(null)} />}
      <ul className="space-y-2.5">
        {shown.map((p) => (
          <li key={p.id} className="group text-[13px]">
            <div className="flex items-center gap-1.5">
              <Phone className="size-3.5 shrink-0 text-ink-subtle" />
              <a href={`tel:${p.number}`} className="font-medium tabular-nums text-link hover:underline">
                {formatPhone(p.number)}
                {p.extension ? ` ext. ${p.extension}` : ""}
              </a>
              <button
                className="opacity-0 group-hover:opacity-100"
                onClick={() => {
                  copyText(p.number);
                  toast({ message: "Copied phone number" });
                }}
                aria-label="Copy phone number"
              >
                <Copy className="size-3.5 text-ink-subtle" />
              </button>
              <Pill label={p.status} color={PHONE_STATUS_COLORS[p.status]} className="ml-auto" />
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label={`${formatPhone(p.number)} options`}>
                    <MoreHorizontal />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                  <DropdownMenuItem
                    onSelect={() =>
                      setTimeout(
                        () => setDialog({ editing: { id: p.id, number: p.number, extension: p.extension, type: p.type, ivrPath: p.ivrPath, status: p.status, notes: p.notes, contactId: p.contactId } }),
                        0,
                      )
                    }
                  >
                    Edit
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => openComposer("call", undefined, { phoneNumberId: p.id })}>Log call</DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {data.options.phoneStatus
                    .filter((s) => s.value !== p.status)
                    .map((s) => (
                      <DropdownMenuItem key={s.value} onSelect={() => act(() => setPhoneStatus(data.object, data.id, p.id, s.value), `Marked ${formatPhone(p.number)} as ${s.label}`)}>
                        <span className="size-2 rounded-full" style={{ background: PHONE_STATUS_COLORS[s.value] ?? s.color }} /> Mark {s.label}
                      </DropdownMenuItem>
                    ))}
                  <DropdownMenuSeparator />
                  <DropdownMenuItem
                    destructive
                    onSelect={async () => {
                      const res = await deletePhoneNumber(data.object, data.id, p.id);
                      if (!res.ok) return toast({ message: res.error });
                      const snap = res.data!;
                      toast({ message: `Deleted ${formatPhone(p.number)}`, undo: async () => void (await savePhoneNumber(data.object, data.id, null, snap)) });
                      refresh();
                    }}
                  >
                    Delete
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
            <div className="pl-5 text-[12px] text-ink-muted">
              {p.type}
              {data.object === "CONTACT" && p.source === "company" ? " · company line" : ""}
              {data.object === "COMPANY" && p.contactName ? ` · ${p.contactName}` : ""}
              {p.ivrPath ? ` · IVR: ${p.ivrPath}` : ""}
            </div>
            {p.notes && <div className="pl-5 text-[12px] text-ink-muted">{p.notes}</div>}
            <div className="flex items-center gap-2 pl-5 text-[12px] text-ink-subtle">
              {p.lastDialedAt ? `Last dialed ${friendlyDateTime(p.lastDialedAt)}` : "Never dialed"}
              <button className="text-link opacity-0 hover:underline group-hover:opacity-100" onClick={() => openComposer("call", undefined, { phoneNumberId: p.id })}>
                Log call
              </button>
            </div>
          </li>
        ))}
      </ul>
      {!data.phones.length && <p className="text-[13px] text-ink-subtle">No phone numbers yet.</p>}
      {more > 0 && (
        <button className="mt-1 text-[13px] text-link hover:underline" onClick={showAll}>
          View all phone numbers ({data.phones.length})
        </button>
      )}
    </RecordCard>
  );
}

function DealsCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  return (
    <RecordCard
      id={`right:${card.id}`}
      title={card.title ?? "Deals"}
      count={data.deals.length}
      actions={
        <>
          <Tooltip content="Creating deals arrives in build step 7">
            <span>
              <Button size="sm" variant="ghost" disabled>
                <Plus /> Add
              </Button>
            </span>
          </Tooltip>
          <CardGear label="Card settings" />
        </>
      }
    >
      {data.deals.length ? (
        <ul className="space-y-2">
          {data.deals.slice(0, card.limit ?? 5).map((d) => (
            <li key={d.id} className="rounded-[4px] border border-line p-2.5 text-[13px]">
              <div className="font-medium">{d.name}</div>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[12px] text-ink-muted">
                <Pill label={d.stage} color={d.stageColor ?? undefined} />
                {d.amount !== null && <span>{formatNumber(d.amount, "currency")}</span>}
                {d.closeDate && <span>Close {formatDate(d.closeDate)}</span>}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-col items-center py-3 text-center">
          <svg width="72" height="52" viewBox="0 0 72 52" aria-hidden className="mb-2">
            <rect x="6" y="10" width="60" height="36" rx="4" fill="var(--surface-muted)" stroke="var(--border-strong)" />
            <rect x="14" y="30" width="8" height="10" rx="1" fill="#00bda5" />
            <rect x="27" y="24" width="8" height="16" rx="1" fill="#00a4bd" />
            <rect x="40" y="18" width="8" height="22" rx="1" fill="#6a78d1" />
            <rect x="53" y="13" width="8" height="27" rx="1" fill="#ff7a59" />
          </svg>
          <p className="text-[13px] text-ink-muted">Track the revenue opportunities associated with this record.</p>
        </div>
      )}
    </RecordCard>
  );
}

function ProjectsCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const items = data.caseStudies.slice(0, card.limit ?? 3);
  return (
    <RecordCard id={`right:${card.id}`} title={card.title ?? "Relevant Enosis projects"} count={data.caseStudies.length} actions={<CardGear label="Card settings" />}>
      <ul className="space-y-2.5">
        {items.map((cs) => (
          <li key={cs.id} className="text-[13px]">
            {cs.url ? (
              <a href={cs.url} target="_blank" rel="noreferrer" className="font-medium text-link hover:underline">
                {cs.title}
              </a>
            ) : (
              <div className="font-medium">{cs.title}</div>
            )}
            {cs.summary && <p className="text-[12px] text-ink-muted">{cs.summary}</p>}
            <div className="mt-1 flex flex-wrap gap-1">
              {cs.industry && <Pill label={cs.industry} />}
              {cs.technologies.map((t) => (
                <Pill key={t} label={t} className={cn(cs.matches.includes(t) && "border-[#00bda5] bg-[#e5f8f6]")} />
              ))}
            </div>
          </li>
        ))}
      </ul>
      {!items.length && <p className="text-[13px] text-ink-subtle">No projects match this {data.object === "CONTACT" ? "contact's company" : "company"}&apos;s industry or technologies.</p>}
    </RecordCard>
  );
}

function SegmentsCard({ card }: { card: CardConfig }) {
  const { data } = useRecord();
  const { shown, more, showAll } = useLimit(data.segments, card.limit);
  return (
    <RecordCard id={`right:${card.id}`} title={card.title ?? "Segments"} count={data.segments.length} actions={<CardGear label="Card settings" />}>
      <ul className="space-y-1.5">
        {shown.map((s) => (
          <li key={s.id} className="flex items-center gap-2 text-[13px]">
            <Link href={`/segments/${s.id}`} className="min-w-0 truncate text-link hover:underline">
              {s.name}
            </Link>
            <span className="ml-auto shrink-0 text-[12px] text-ink-subtle">{s.type === "ACTIVE" ? "Active" : "Static"}</span>
          </li>
        ))}
      </ul>
      {!data.segments.length && <p className="text-[13px] text-ink-subtle">Not in any segment. Add it from a list&apos;s bulk actions.</p>}
      {more > 0 && (
        <button className="mt-1 text-[13px] text-link hover:underline" onClick={showAll}>
          View all segments ({data.segments.length})
        </button>
      )}
    </RecordCard>
  );
}
