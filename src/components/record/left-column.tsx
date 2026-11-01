"use client";

import { CalendarDays, ChevronDown, ChevronLeft, Copy, Mail, MoreHorizontal, NotebookPen, Pencil, Phone, Settings2, SquareCheckBig, Star } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PropertyPicker } from "@/components/index/property-picker";
import { CompanyLogo, LocalTime, copyText } from "@/components/index/values";
import { Button, Input, Label } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Tooltip,
} from "@/components/ui/overlays";
import { enrichCompanyAction } from "@/lib/crm/company-actions";
import { formatDateTime, localTime } from "@/lib/crm/dates";
import { cloneRecord, deleteRecord, getRecordHistory, setFollow, setKeyInfo, type HistoryRow } from "@/lib/crm/record-actions";
import type { QuickAction } from "@/lib/crm/record-types";
import { colorFor, formatPhone, initials, phoneHref } from "@/lib/utils";
import { RecordDealDialog } from "./deal-lead-cards";
import { useRecord } from "./record-context";
import { CARD_ACCENTS, PropertyRow, RecordCard, isShown } from "./record-ui";

const QUICK_ACTIONS: Record<QuickAction, { label: string; icon: typeof Mail }> = {
  note: { label: "Note", icon: NotebookPen },
  email: { label: "Email", icon: Mail },
  call: { label: "Call", icon: Phone },
  task: { label: "Task", icon: SquareCheckBig },
  meeting: { label: "Meeting", icon: CalendarDays },
  more: { label: "More", icon: MoreHorizontal },
};

export function LeftColumn() {
  const { data } = useRecord();
  const defMap = new Map(data.defs.map((d) => [d.name, d]));
  return (
    <aside className="thin-scroll min-h-0 space-y-3 overflow-y-auto pb-1">
      <HeaderCard />
      <KeyInfoCard />
      {data.layout.config.left.cards.map((card) => {
        const defs = (card.properties ? card.properties.map((p) => defMap.get(p)).filter((d) => !!d) : data.defs.filter((d) => d.groupName === card.group)).filter(
          (d) => !d.isVirtual && isShown(d, data.values),
        );
        if (!defs.length) return null;
        return (
          <RecordCard key={card.id} id={`left:${card.id}`} title={card.title}>
            {defs.map((d) => (
              <PropertyRow key={d.name} def={d} value={data.values[d.name]} />
            ))}
          </RecordCard>
        );
      })}
    </aside>
  );
}

function HeaderCard() {
  const { data, openComposer, toast, refresh } = useRecord();
  const router = useRouter();
  const [historyOpen, setHistoryOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [creatingDeal, setCreatingDeal] = useState(false);
  const { header, object, labels } = data;
  const time = localTime(header.timeZone);

  return (
    <div className="rounded-[6px] border border-line bg-surface px-5 pb-5 pt-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between">
        <Link href={labels.path} className="flex items-center gap-1 text-[13px] capitalize text-link hover:underline">
          <ChevronLeft className="size-4" /> {labels.plural}
        </Link>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button size="sm" variant="ghost" className="text-link">
              Actions <ChevronDown />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem
              onSelect={async () => {
                const res = await setFollow(object, data.id, !data.isFollowing);
                if (!res.ok) return toast({ message: res.error });
                toast({ message: data.isFollowing ? "Unfollowed" : `Following this ${labels.singular}. You'll be notified about changes` });
                refresh();
              }}
            >
              {data.isFollowing ? "Unfollow" : "Follow"}
            </DropdownMenuItem>
            <Tooltip content="Duplicates and merge arrive in build step 11" side="left">
              <span>
                <DropdownMenuItem disabled>Merge</DropdownMenuItem>
              </span>
            </Tooltip>
            <DropdownMenuItem
              onSelect={async () => {
                const res = await cloneRecord(object, data.id);
                if (!res.ok) return toast({ message: res.error });
                router.push(`${labels.path}/${res.data!.id}`);
              }}
            >
              Clone
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>View property history</DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                copyText(window.location.href.split("?")[0]);
                toast({ message: "Link copied" });
              }}
            >
              Copy link
            </DropdownMenuItem>
            {object === "COMPANY" && (
              <>
                <DropdownMenuSeparator />
                {data.integrations.map((p) => {
                  const ready = p.configured && p.enabled;
                  const item = (
                    <DropdownMenuItem
                      key={p.id}
                      disabled={!ready}
                      onSelect={async () => {
                        toast({ message: `Enriching from ${p.name}…` });
                        const res = await enrichCompanyAction(data.id, p.id);
                        if (!res.ok) return toast({ message: res.error });
                        const { status, changed, signals } = res.data!;
                        toast({
                          message:
                            status === "no_match"
                              ? `${p.name} has no match for this domain`
                              : status === "no_change"
                                ? `${p.name}: nothing new to fill in`
                                : `${p.name}: updated ${changed} field${changed === 1 ? "" : "s"}${signals ? `, added ${signals} buying signal${signals === 1 ? "" : "s"}` : ""}`,
                        });
                        refresh();
                      }}
                    >
                      Enrich from {p.name}
                    </DropdownMenuItem>
                  );
                  return ready ? (
                    item
                  ) : (
                    <Tooltip key={p.id} content={p.configured ? "Turn it on in Settings → Integrations" : "Not connected: an admin adds the API key on the server"} side="left">
                      <span>{item}</span>
                    </Tooltip>
                  );
                })}
              </>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuItem destructive disabled={!data.canDelete} onSelect={() => setConfirmDelete(true)}>
              Delete
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      <div className="flex items-start gap-3">
        {object === "COMPANY" ? (
          <CompanyLogo name={header.name} domain={header.domain} size={56} />
        ) : (
          <span className="flex size-14 shrink-0 items-center justify-center rounded-full text-[18px] font-semibold text-white" style={{ background: colorFor(data.id) }} aria-hidden>
            {initials(header.name)}
          </span>
        )}
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h1 className="min-w-0 break-words text-[20px] font-medium leading-tight">{header.name}</h1>
            <NameEditor />
          </div>
          {header.subtitle && (
            <div className="mt-0.5 text-[13px] text-ink-muted">
              {object === "CONTACT" && header.primaryCompany ? (
                <>
                  {header.subtitle.replace(new RegExp(`${escapeRegExp(header.primaryCompany.name)}$`), "")}
                  <Link href={`/companies/${header.primaryCompany.id}`} className="text-link hover:underline">
                    {header.primaryCompany.name}
                  </Link>
                </>
              ) : (
                header.subtitle
              )}
            </div>
          )}
          {header.domain && <CopyLine href={`https://${header.domain}`} text={header.domain} label="domain" />}
          {header.email && <CopyLine href={`mailto:${header.email}`} text={header.email} label="email" />}
          {header.phone && <CopyLine href={phoneHref(header.phone)} text={formatPhone(header.phone)} copy={header.phone} label="phone number" />}
          {time && (
            <div className="mt-1 flex min-w-0 items-center gap-1 text-[12px] text-ink-muted">
              <LocalTime tz={header.timeZone} suffix="local time" icon />
              <span className="truncate text-ink-subtle">· {header.timeZone}</span>
            </div>
          )}
        </div>
      </div>

      <div className="mt-5 flex justify-between gap-1">
        {data.layout.config.left.quickActions.map((key) => {
          const { label, icon: Icon } = QUICK_ACTIONS[key];
          const button = (
            <button className="group flex w-12 flex-col items-center gap-1 text-[12px] text-ink" onClick={key === "more" ? undefined : () => openComposer(key)} aria-label={label}>
              <span className="flex size-9 items-center justify-center rounded-full border border-line-strong bg-surface-muted text-ink-muted group-hover:border-link group-hover:text-link">
                <Icon className="size-4" />
              </span>
              {label}
            </button>
          );
          if (key !== "more") return <span key={key}>{button}</span>;
          return (
            <DropdownMenu key={key}>
              <DropdownMenuTrigger asChild>{button}</DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => setCreatingDeal(true)}>Create deal</DropdownMenuItem>
                <DropdownMenuItem onSelect={() => setHistoryOpen(true)}>View property history</DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => {
                    copyText(window.location.href.split("?")[0]);
                    toast({ message: "Link copied" });
                  }}
                >
                  Copy record link
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          );
        })}
      </div>

      <HistoryDialog open={historyOpen} onOpenChange={setHistoryOpen} />
      {creatingDeal && <RecordDealDialog onClose={() => setCreatingDeal(false)} />}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent title={`Delete ${header.name}?`}>
          <div className="space-y-4 px-6 py-5 text-[13px]">
            <p>Deleted records can be restored for 90 days. Their activities and associations are kept.</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setConfirmDelete(false)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={async () => {
                  const res = await deleteRecord(object, data.id);
                  setConfirmDelete(false);
                  if (!res.ok) return toast({ message: res.error });
                  router.push(labels.path);
                }}
              >
                Delete
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function CopyLine({ href, text, copy, label }: { href: string; text: string; copy?: string; label: string }) {
  const { toast } = useRecord();
  return (
    <div className="group mt-1 flex min-w-0 items-center gap-1 text-[13px]">
      <a href={href} target={href.startsWith("http") ? "_blank" : undefined} rel="noreferrer" className="truncate text-link hover:underline">
        {text}
      </a>
      <button
        className="shrink-0 rounded p-0.5 text-ink-subtle opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100"
        onClick={() => {
          copyText(copy ?? text);
          toast({ message: `Copied ${label}` });
        }}
        aria-label={`Copy ${label}`}
      >
        <Copy className="size-3.5" />
      </button>
    </div>
  );
}

/** Pencil next to the name: first/last name for contacts, company name for companies. */
function NameEditor() {
  const { data, editProperty } = useRecord();
  const isContact = data.object === "CONTACT";
  const [open, setOpen] = useState(false);
  const [first, setFirst] = useState("");
  const [last, setLast] = useState("");
  const [error, setError] = useState<string | null>(null);
  return (
    <Popover
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (o) {
          setFirst(String((isContact ? data.values.firstName : data.values.name) ?? ""));
          setLast(String(data.values.lastName ?? ""));
          setError(null);
        }
      }}
    >
      <PopoverTrigger asChild>
        <button className="mt-1 shrink-0 rounded p-1 text-ink-subtle hover:bg-surface-hover hover:text-ink" aria-label="Edit name">
          <Pencil className="size-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[280px] p-3">
        <form
          className="space-y-2"
          onSubmit={async (e) => {
            e.preventDefault();
            const err = isContact
              ? ((await editProperty("firstName", first)) ?? (await editProperty("lastName", last)))
              : !first.trim()
                ? "Company name is required"
                : await editProperty("name", first);
            if (err) return setError(err);
            setOpen(false);
          }}
        >
          <div>
            <Label htmlFor="n-first">{isContact ? "First name" : "Company name"}</Label>
            <Input id="n-first" value={first} onChange={(e) => setFirst(e.target.value)} autoFocus />
          </div>
          {isContact && (
            <div>
              <Label htmlFor="n-last">Last name</Label>
              <Input id="n-last" value={last} onChange={(e) => setLast(e.target.value)} />
            </div>
          )}
          {error && <p className="text-[12px] text-danger">{error}</p>}
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" variant="primary">
              Save
            </Button>
          </div>
        </form>
      </PopoverContent>
    </Popover>
  );
}

function KeyInfoCard() {
  const { data, toast, refresh } = useRecord();
  const [pickerOpen, setPickerOpen] = useState(false);
  const defMap = new Map(data.defs.map((d) => [d.name, d]));
  const selected = data.keyInfo;
  const shown = selected.map((p) => defMap.get(p)).filter((d) => !!d && isShown(d, data.values));

  async function save(next: string[] | null) {
    const res = await setKeyInfo(data.object, next);
    if (!res.ok) return toast({ message: res.error });
    refresh();
  }

  return (
    <RecordCard
      id="left:keyinfo"
      title={`Key information`}
      icon={Star}
      accent={CARD_ACCENTS.keyInfo}
      actions={
        <Popover open={pickerOpen} onOpenChange={setPickerOpen}>
          <Tooltip content="Choose the properties shown here">
            <PopoverTrigger asChild>
              <button className="flex size-7 items-center justify-center rounded text-ink-muted hover:bg-surface-hover" aria-label="Choose key information properties">
                <Settings2 className="size-4" />
              </button>
            </PopoverTrigger>
          </Tooltip>
          <PopoverContent align="end">
            <PropertyPicker
              defs={data.defs.filter((d) => !d.isVirtual || d.name === "targetCount" || d.name === "primaryCompany")}
              groups={data.groups}
              selected={new Set(selected)}
              onPick={(d) => save(selected.includes(d.name) ? selected.filter((p) => p !== d.name) : [...selected, d.name])}
            />
            {data.keyInfoIsCustom && (
              <button className="w-full border-t border-line px-3 py-2 text-left text-[13px] text-link hover:bg-surface-hover" onClick={() => save(null)}>
                Reset to the {data.layout.name.toLowerCase()} layout
              </button>
            )}
          </PopoverContent>
        </Popover>
      }
    >
      {shown.map((d) => (
        <PropertyRow key={d!.name} def={d!} value={data.values[d!.name]} compact />
      ))}
      {!shown.length && <p className="text-[13px] text-ink-subtle">No properties chosen. Use the gear to add some.</p>}
    </RecordCard>
  );
}

function HistoryDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { data } = useRecord();
  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  useEffect(() => {
    if (!open) return setRows(null);
    let live = true;
    getRecordHistory(data.object, data.id).then((r) => live && setRows(r));
    return () => {
      live = false;
    };
  }, [open, data.object, data.id]);
  const label = (p: string) => data.defs.find((d) => d.name === p)?.label ?? p;
  const fmt = (v: unknown, p: string) => {
    if (v === null || v === undefined || v === "") return "(empty)";
    const def = data.defs.find((d) => d.name === p);
    if (def?.type === "USER") return data.users.find((u) => u.id === v)?.name ?? "Unknown user";
    if (def?.type === "DATETIME" || def?.type === "DATE") return formatDateTime(String(v));
    return Array.isArray(v) ? v.join(", ") : String(v);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent side="right" title="Property history" className="w-[520px]">
        <div className="thin-scroll flex-1 overflow-y-auto px-6 py-4 text-[13px]">
          {!rows && <p className="text-ink-subtle">Loading…</p>}
          {rows && !rows.length && <p className="text-ink-subtle">No changes recorded yet.</p>}
          <ol className="space-y-3">
            {rows?.map((r) => {
              const changes = r.changes ?? {};
              const rule = typeof changes.rule === "string" ? changes.rule : null;
              const props = r.action === "update" ? Object.entries(changes).filter(([k]) => k !== "rule") : [];
              return (
                <li key={r.id} className="border-b border-line pb-3 last:border-b-0">
                  {props.map(([p, c]) => {
                    const { from, to } = (c ?? {}) as { from?: unknown; to?: unknown };
                    return (
                      <div key={p}>
                        <span className="font-medium">{label(p)}</span>: <span className="text-ink-muted line-through">{fmt(from, p)}</span> → {fmt(to, p)}
                      </div>
                    );
                  })}
                  {r.action !== "update" && <div className="font-medium capitalize">{r.action.replace(/_/g, " ")}</div>}
                  <div className="mt-0.5 text-[12px] text-ink-subtle">
                    {formatDateTime(r.at)} · {rule ? `Automation: ${rule}` : r.user}
                  </div>
                </li>
              );
            })}
          </ol>
        </div>
      </DialogContent>
    </Dialog>
  );
}
