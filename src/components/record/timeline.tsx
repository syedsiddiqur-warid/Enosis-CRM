"use client";

import { Check, ChevronDown, ChevronRight, MoreHorizontal, Search, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Pill, UserAvatar } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import { Checkbox, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, Popover, PopoverContent, PopoverTrigger } from "@/components/ui/overlays";
import { DEFAULT_TZ, formatDateTime, friendlyDateTime, monthLabel } from "@/lib/crm/dates";
import { deleteActivity, restoreActivity, setTaskDone } from "@/lib/crm/record-actions";
import type { ComposerKind, RecordActivity } from "@/lib/crm/record-types";
import { cn, formatPhone } from "@/lib/utils";
import { useRecord } from "./record-context";
import { ActivityIcon, activityMeta } from "./record-ui";

type Type = RecordActivity["type"];
const SUB_TABS: { key: "ALL" | Type; label: string }[] = [
  { key: "ALL", label: "All activities" },
  { key: "NOTE", label: "Notes" },
  { key: "EMAIL", label: "Emails" },
  { key: "CALL", label: "Calls" },
  { key: "TASK", label: "Tasks" },
  { key: "MEETING", label: "Meetings" },
];
const ALL_TYPES: Type[] = ["NOTE", "EMAIL", "CALL", "TASK", "MEETING", "SYSTEM"];
const TYPE_LABELS: Record<Type, string> = { NOTE: "Notes", EMAIL: "Emails", CALL: "Calls", TASK: "Tasks", MEETING: "Meetings", SYSTEM: "Updates (system events)" };
const RANGES = [
  { key: "all", label: "All time", days: null },
  { key: "7", label: "Last 7 days", days: 7 },
  { key: "30", label: "Last 30 days", days: 30 },
  { key: "90", label: "Last 90 days", days: 90 },
  { key: "365", label: "Last 12 months", days: 365 },
] as const;
const COMPOSER: Partial<Record<Type, ComposerKind>> = { NOTE: "note", EMAIL: "email", CALL: "call", TASK: "task", MEETING: "meeting" };

export const isOpenTask = (a: RecordActivity) => a.type === "TASK" && a.taskStatus !== "COMPLETED";
export const isOverdue = (a: RecordActivity, now = Date.now()) => isOpenTask(a) && !!a.dueAt && new Date(a.dueAt).getTime() < now;
/** When an activity "happens" on the timeline: tasks by due date, meetings by start. */
export const activityTime = (a: RecordActivity) => (a.type === "TASK" ? (a.completedAt ?? a.dueAt ?? a.occurredAt) : a.type === "MEETING" ? (a.startAt ?? a.occurredAt) : a.occurredAt);

/** One-line card title. */
export function activityTitle(a: RecordActivity, userName: (id: string | null) => string) {
  const d = a.systemData ?? {};
  switch (a.type) {
    case "NOTE":
      return `Note by ${userName(a.ownerId)}`;
    case "EMAIL":
      return `${a.emailDirection === "INBOUND" ? "Email received" : "Logged email"}${a.subject ? ` – ${a.subject}` : ""}`;
    case "CALL":
      return `Logged call${a.callResult ? ` – ${a.callResult}` : ""}`;
    case "TASK":
      return a.title ?? "Task";
    case "MEETING":
      return `Meeting${a.title ? ` – ${a.title}` : ""}`;
    case "SYSTEM":
      if (d.kind === "imported") return `Created from Import${d.source ? ` (${d.source})` : ""}`;
      if (d.kind === "created") return d.source === "Clone" ? "Created as a copy" : "Record created";
      if (d.kind === "property_change") {
        if (d.property === "lifecycleStage" && d.to) return `Lifecycle stage moved to ${String(d.to)}`;
        return `${d.label ?? d.property} ${d.to === null || d.to === "" ? "cleared" : `set to ${String(d.to)}`}`;
      }
      return "Update";
  }
}

export function Timeline() {
  const { data } = useRecord();
  const [sub, setSub] = useState<"ALL" | Type>("ALL");
  const [q, setQ] = useState("");
  const [types, setTypes] = useState<Set<Type>>(new Set(ALL_TYPES));
  const [range, setRange] = useState<(typeof RANGES)[number]["key"]>("all");
  const [userId, setUserId] = useState("");
  // null = each card's default; true/false = "Collapse all" / "Expand all"
  const [allOpen, setAllOpen] = useState<boolean | null>(null);
  const now = Date.now();

  const counts = useMemo(() => {
    const c: Record<string, number> = { ALL: data.activities.length };
    for (const a of data.activities) c[a.type] = (c[a.type] ?? 0) + 1;
    return c;
  }, [data.activities]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const days = RANGES.find((r) => r.key === range)?.days ?? null;
    return data.activities.filter((a) => {
      if (sub !== "ALL" ? a.type !== sub : !types.has(a.type)) return false;
      if (userId && a.ownerId !== userId && a.assigneeId !== userId) return false;
      // Open tasks and upcoming items always show; the range limits history
      if (days && !isOpenTask(a) && new Date(activityTime(a)).getTime() < now - days * 864e5) return false;
      if (s) {
        const hay = [a.title, a.body, a.subject, a.callResult, a.callPath, a.dialedNumber, a.location, a.systemData?.label, a.systemData?.to, ...a.contacts.map((c) => c.name)]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [data.activities, sub, types, userId, range, q, now]);

  const groups = useMemo(() => {
    const overdue: RecordActivity[] = [];
    const upcoming: RecordActivity[] = [];
    const months = new Map<string, RecordActivity[]>();
    for (const a of filtered) {
      if (isOverdue(a, now)) overdue.push(a);
      else if (isOpenTask(a) || (a.type === "MEETING" && new Date(activityTime(a)).getTime() > now)) upcoming.push(a);
      else {
        const m = monthLabel(activityTime(a));
        months.set(m, [...(months.get(m) ?? []), a]);
      }
    }
    const byTime = (dir: 1 | -1) => (x: RecordActivity, y: RecordActivity) => dir * (new Date(activityTime(x)).getTime() - new Date(activityTime(y)).getTime());
    overdue.sort(byTime(1));
    upcoming.sort(byTime(1));
    const history = [...months.entries()].map(([label, items]) => ({ label, items: items.sort(byTime(-1)) }));
    history.sort((a, b) => new Date(activityTime(b.items[0])).getTime() - new Date(activityTime(a.items[0])).getTime());
    return [
      ...(overdue.length ? [{ label: "Overdue", items: overdue, tone: "danger" as const }] : []),
      ...(upcoming.length ? [{ label: "Upcoming", items: upcoming, tone: "default" as const }] : []),
      ...history.map((h) => ({ ...h, tone: "default" as const })),
    ];
  }, [filtered, now]);

  const filtersActive = q !== "" || types.size !== ALL_TYPES.length || range !== "all" || userId !== "";
  const clear = () => {
    setQ("");
    setTypes(new Set(ALL_TYPES));
    setRange("all");
    setUserId("");
  };

  return (
    <div>
      <div className="flex flex-wrap gap-1 border-b border-line">
        {SUB_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => setSub(t.key)}
            className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", sub === t.key ? "border-link font-medium text-ink" : "border-transparent text-ink-muted hover:text-ink")}
            aria-pressed={sub === t.key}
          >
            {t.label}
            {t.key !== "ALL" && counts[t.key] ? <span className="ml-1 text-ink-subtle">{counts[t.key]}</span> : null}
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2 py-3">
        <div className="relative w-[220px]">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-ink-subtle" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search activities" className="pl-8" aria-label="Search activities" />
        </div>
        {sub === "ALL" && (
          <Popover>
            <PopoverTrigger asChild>
              <Button size="sm" variant="ghost" className="text-link">
                Activity ({types.size}/{ALL_TYPES.length}) <ChevronDown />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[240px] py-1">
              {ALL_TYPES.map((t) => (
                <label key={t} className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-[13px] hover:bg-surface-hover">
                  <Checkbox
                    checked={types.has(t)}
                    onCheckedChange={(c) =>
                      setTypes((s) => {
                        const n = new Set(s);
                        if (c) n.add(t);
                        else n.delete(t);
                        return n;
                      })
                    }
                  />
                  <span className="flex-1">{TYPE_LABELS[t]}</span>
                  <span className="text-ink-subtle">{counts[t] ?? 0}</span>
                </label>
              ))}
            </PopoverContent>
          </Popover>
        )}
        <Select value={range} onChange={(e) => setRange(e.target.value as typeof range)} className="h-7 w-auto border-transparent text-link" aria-label="Date range">
          {RANGES.map((r) => (
            <option key={r.key} value={r.key}>
              {r.label}
            </option>
          ))}
        </Select>
        <Select value={userId} onChange={(e) => setUserId(e.target.value)} className="h-7 w-auto max-w-[180px] border-transparent text-link" aria-label="Activity assigned to">
          <option value="">Assigned to: anyone</option>
          {data.users.map((u) => (
            <option key={u.id} value={u.id}>
              {u.name ?? u.email}
            </option>
          ))}
        </Select>
        {filtersActive && (
          <Button size="sm" variant="ghost" onClick={clear}>
            <X /> Clear all
          </Button>
        )}
        <Button size="sm" variant="ghost" className="ml-auto text-link" onClick={() => setAllOpen((o) => (o === false ? true : false))}>
          {allOpen === false ? "Expand all" : "Collapse all"}
        </Button>
      </div>

      {groups.map((g) => (
        <section key={g.label} className="mb-5">
          <h3 className={cn("mb-2 text-[13px] font-semibold", g.tone === "danger" && "text-danger")}>
            {g.label} <span className="font-normal text-ink-subtle">({g.items.length})</span>
          </h3>
          <div className="space-y-2">
            {g.items.map((a) => (
              <ActivityCard key={a.id} a={a} forceOpen={allOpen} />
            ))}
          </div>
        </section>
      ))}
      {!groups.length && (
        <div className="rounded-[4px] border border-dashed border-line-strong py-10 text-center text-[13px] text-ink-muted">
          {data.activities.length ? "No activities match these filters." : "No activities yet. Log a call, note or email from the buttons on the left."}
        </div>
      )}
      {data.activitiesTruncated && <p className="text-center text-[12px] text-ink-subtle">Showing the latest {data.activities.length} activities.</p>}
    </div>
  );
}

function ActivityCard({ a, forceOpen }: { a: RecordActivity; forceOpen: boolean | null }) {
  const { data, openComposer, toast, refresh } = useRecord();
  const [ownOpen, setOwnOpen] = useState<boolean | null>(null);
  const open = ownOpen ?? forceOpen ?? a.type !== "SYSTEM";
  const userName = (id: string | null) => (id ? (data.users.find((u) => u.id === id)?.name ?? "Unknown user") : "System");
  const owner = data.users.find((u) => u.id === a.ownerId);
  const overdue = isOverdue(a);
  const done = a.type === "TASK" && a.taskStatus === "COMPLETED";
  // On a company, show which contact an activity was with
  const otherContacts = data.object === "COMPANY" ? a.contacts : [];

  async function toggleDone() {
    const res = await setTaskDone(data.object, data.id, a.id, !done);
    if (!res.ok) return toast({ message: res.error });
    toast({ message: done ? "Task reopened" : "Task completed", undo: async () => void (await setTaskDone(data.object, data.id, a.id, done)) });
    refresh();
  }

  async function remove() {
    const res = await deleteActivity(data.object, data.id, a.id);
    if (!res.ok) return toast({ message: res.error });
    toast({ message: `${activityMeta(a.type).label} deleted`, undo: async () => void (await restoreActivity(data.object, data.id, a.id)) });
    refresh();
  }

  return (
    <article className={cn("rounded-[4px] border bg-surface", overdue ? "border-[#f2545b]/50" : "border-line")}>
      <div className="flex items-start gap-3 px-4 py-3">
        {a.type === "TASK" ? (
          <button
            onClick={toggleDone}
            className={cn("mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2", done ? "border-[#00bda5] bg-[#00bda5] text-white" : "border-line-strong hover:border-[#00bda5]")}
            aria-label={done ? "Mark task as not done" : "Mark task as complete"}
          >
            {done && <Check className="size-3" strokeWidth={3} />}
          </button>
        ) : (
          <ActivityIcon type={a.type} size={24} />
        )}
        <button className="min-w-0 flex-1 text-left" onClick={() => setOwnOpen(!open)} aria-expanded={open}>
          <div className="flex items-center gap-1.5 text-[13px]">
            {open ? <ChevronDown className="size-3.5 shrink-0 text-ink-subtle" /> : <ChevronRight className="size-3.5 shrink-0 text-ink-subtle" />}
            <span className={cn("truncate font-medium", done && "text-ink-muted line-through")}>{activityTitle(a, userName)}</span>
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-x-2 pl-5 text-[12px] text-ink-muted">
            {a.type === "TASK" ? (
              <span className={cn(overdue && "font-medium text-danger")}>
                {done ? `Completed ${friendlyDateTime(a.completedAt)}` : `Due ${friendlyDateTime(a.dueAt)}`}
                {overdue && " · Overdue"}
              </span>
            ) : (
              <span>{friendlyDateTime(activityTime(a))}</span>
            )}
            {a.type !== "SYSTEM" && owner && <span>· {owner.name}</span>}
            {a.systemData?.rule && <span>· by automation “{a.systemData.rule}”</span>}
            {a.type === "SYSTEM" && a.systemData?.kind === "property_change" && <span className="text-link">{open ? "Hide details" : "View details"}</span>}
            {otherContacts.map((c) => (
              <Link key={c.id} href={`/contacts/${c.id}`} className="text-link hover:underline" onClick={(e) => e.stopPropagation()}>
                · {c.name}
              </Link>
            ))}
          </div>
        </button>
        {a.type !== "SYSTEM" && (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="icon-sm" variant="ghost" aria-label="Activity actions">
                <MoreHorizontal />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => openComposer(COMPOSER[a.type]!, a)}>Edit</DropdownMenuItem>
              {a.type === "TASK" && <DropdownMenuItem onSelect={toggleDone}>{done ? "Mark as not done" : "Mark as complete"}</DropdownMenuItem>}
              <DropdownMenuSeparator />
              <DropdownMenuItem destructive onSelect={remove}>
                Delete
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        )}
      </div>
      {open && <ActivityBody a={a} />}
    </article>
  );
}

function Detail({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{label}</div>
      <div className="text-[13px]">{children}</div>
    </div>
  );
}

function ActivityBody({ a }: { a: RecordActivity }) {
  const { data } = useRecord();
  const user = (id: string | null) => data.users.find((u) => u.id === id);
  const body = a.body ? <p className="whitespace-pre-wrap text-[13px] leading-relaxed">{a.body}</p> : null;
  const pad = "border-t border-line px-4 py-3 pl-[52px]";

  switch (a.type) {
    case "CALL":
      return (
        <div className={cn(pad, "space-y-3")}>
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <Detail label="Number">{a.dialedNumber ? <a href={`tel:${a.dialedNumber}`} className="tabular-nums text-link hover:underline">{formatPhone(a.dialedNumber)}</a> : "--"}</Detail>
            <Detail label="Path">{a.callPath ?? "--"}</Detail>
            <Detail label="Outcome">{a.callResult ? <Pill label={a.callResult} color={data.options.callResult.find((o) => o.value === a.callResult)?.color} /> : "--"}</Detail>
            <Detail label="Duration">{a.durationSec ? `${Math.floor(a.durationSec / 60)}m ${a.durationSec % 60}s` : "--"}</Detail>
            {a.gatekeeperType && <Detail label="Gatekeeper">{a.gatekeeperType}</Detail>}
            {a.targetContact && data.object === "COMPANY" && (
              <Detail label="Contacted">
                <Link href={`/contacts/${a.targetContact.id}`} className="text-link hover:underline">
                  {a.targetContact.name}
                </Link>
              </Detail>
            )}
          </div>
          {body}
        </div>
      );
    case "EMAIL":
      return (
        <div className={cn(pad, "space-y-2")}>
          <div className="text-[12px] text-ink-muted">
            {a.emailTo.length > 0 && <div>To: {a.emailTo.join(", ")}</div>}
            {a.emailCc.length > 0 && <div>Cc: {a.emailCc.join(", ")}</div>}
          </div>
          {body}
        </div>
      );
    case "TASK": {
      const assignee = user(a.assigneeId);
      return (
        <div className={cn(pad, "space-y-3")}>
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <Detail label="Assigned to">
              {assignee ? (
                <span className="inline-flex items-center gap-1.5">
                  <UserAvatar user={assignee} size={18} /> {assignee.name}
                </span>
              ) : (
                "--"
              )}
            </Detail>
            <Detail label="Due">{formatDateTime(a.dueAt)}</Detail>
            <Detail label="Type">{a.taskType ?? "--"}</Detail>
            <Detail label="Priority">{a.priority ? <Pill label={a.priority} color={data.options.taskPriority.find((o) => o.value === a.priority)?.color} /> : "--"}</Detail>
          </div>
          {body}
        </div>
      );
    }
    case "MEETING":
      return (
        <div className={cn(pad, "space-y-3")}>
          <div className="grid grid-cols-2 gap-3 @xl:grid-cols-4">
            <Detail label="When">
              {formatDateTime(a.startAt)}
              {a.endAt && ` – ${new Intl.DateTimeFormat("en-US", { timeZone: DEFAULT_TZ, hour: "numeric", minute: "2-digit" }).format(new Date(a.endAt))}`}
            </Detail>
            <Detail label="Location">{a.location ? (/^https?:\/\//.test(a.location) ? <a href={a.location} className="text-link hover:underline" target="_blank" rel="noreferrer">Join link</a> : a.location) : "--"}</Detail>
            <Detail label="Type">{a.meetingType ?? "--"}</Detail>
            <Detail label="Outcome">{a.meetingOutcome ?? "--"}</Detail>
          </div>
          {a.attendees.length > 0 && <div className="text-[12px] text-ink-muted">Attendees: {a.attendees.join(", ")}</div>}
          {body}
        </div>
      );
    case "SYSTEM": {
      const d = a.systemData ?? {};
      if (d.kind !== "property_change") return <div className={cn(pad, "text-[12px] text-ink-muted")}>{formatDateTime(a.occurredAt)}</div>;
      const def = data.defs.find((x) => x.name === d.property);
      const fmt = (v: unknown) => {
        if (v === null || v === undefined || v === "") return "(empty)";
        if (def?.type === "USER") return user(String(v))?.name ?? "Unknown user";
        if (def?.type === "DATETIME" || def?.type === "DATE") return formatDateTime(String(v));
        return Array.isArray(v) ? v.join(", ") : String(v);
      };
      return (
        <div className={cn(pad, "text-[13px]")}>
          <span className="text-ink-muted">{d.label}:</span> <span className="text-ink-muted line-through">{fmt(d.from)}</span> → <span className="font-medium">{fmt(d.to)}</span>
          <div className="mt-1 text-[12px] text-ink-subtle">Changed by {a.ownerId ? (user(a.ownerId)?.name ?? "Unknown user") : d.rule ? `automation “${d.rule}”` : "the system"}</div>
        </div>
      );
    }
    default:
      return body ? <div className={pad}>{body}</div> : null;
  }
}
