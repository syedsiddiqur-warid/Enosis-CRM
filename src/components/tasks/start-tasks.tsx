"use client";

import { ArrowLeft, ArrowRight, Building2, Check, ChevronLeft, Mail, Phone, Timer, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pill } from "@/components/index/values";
import { Button, Select } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { inBusinessHours, nextLocalMorning } from "@/lib/crm/calling-queue";
import { friendlyDateTime, localTime } from "@/lib/crm/dates";
import { logActivity } from "@/lib/crm/record-actions";
import { rescheduleTasks, setTasksDone } from "@/lib/crm/task-actions";
import type { TaskQueueData } from "@/lib/crm/tasks";
import { cn, formatPhone } from "@/lib/utils";

const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const PHONE_STATUS_COLORS: Record<string, string> = { Valid: "#00bda5", "Temp Busy": "#f5c26b", Wrong: "#f2545b", Disconnected: "#f2545b", Unknown: "#cbd6e2" };
const TAB_LABEL: Record<string, string> = { today: "due today", overdue: "overdue", upcoming: "upcoming", open: "open" };

function outcomeTone(result: string) {
  if (result === "Meeting Booked") return "border-[#0091ae] bg-[#e5f5f8] text-[#006e84] hover:bg-[#d0eef3]";
  if (/interested$/i.test(result) && !/not/i.test(result)) return "border-[#00bda5] bg-[#e5f8f6] text-[#00806e] hover:bg-[#d2f3ef]";
  if (/not interested|wrong number/i.test(result)) return "border-[#f2545b]/60 bg-[#fde8e9] text-[#c93a41] hover:bg-[#fbd7d9]";
  return "border-line-strong bg-surface hover:bg-surface-hover";
}

/** HubSpot-style "Start tasks": one task at a time with its contact or company beside it. */
export function StartTasks({ data }: { data: TaskQueueData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [visited, setVisited] = useState<string[]>([]);
  const [done, setDone] = useState(0);
  const [toast, setToast] = useState<string | null>(null);
  const { tasks, current } = data;
  const index = current ? tasks.findIndex((t) => t.id === current.id) : -1;
  const nextId = index >= 0 && tasks.length > 1 ? tasks[(index + 1) % tasks.length].id : null;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = useCallback(
    (id: string | null) => {
      const p = new URLSearchParams(sp.toString());
      if (id) p.set("id", id);
      else p.delete("id");
      router.replace(`${pathname}?${p.toString()}`, { scroll: false });
    },
    [sp, pathname, router],
  );
  const moveTo = (id: string | null) => {
    if (current) setVisited((v) => [...v, current.id]);
    go(id);
  };
  const finished = (message: string) => {
    setToast(message);
    setDone((d) => d + 1);
    if (nextId) moveTo(nextId);
    else router.refresh();
  };
  const back = () => {
    const prev = visited.at(-1);
    if (!prev) return;
    setVisited((v) => v.slice(0, -1));
    go(prev);
  };
  const backHref = `/tasks?${new URLSearchParams(Object.entries({ tab: data.tab === "today" ? "" : data.tab, ...data.filters }).filter(([, v]) => v) as [string, string][]).toString()}`;

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      <div className="flex flex-wrap items-center gap-3 border-b border-line px-5 py-2.5 text-[13px]">
        <Link href={backHref} className="flex items-center gap-1 text-link hover:underline">
          <ChevronLeft className="size-4" /> Tasks
        </Link>
        <span className="text-[15px] font-medium">Start tasks</span>
        <span className="text-ink-muted">
          {tasks.length} {TAB_LABEL[data.tab] ?? "open"} task{tasks.length === 1 ? "" : "s"}
          {done ? ` · ${done} done this session` : ""}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {current && (
            <span className="text-ink-muted">
              {index + 1} of {tasks.length}
            </span>
          )}
          <Tooltip content="Previous (←)">
            <Button size="sm" variant="ghost" onClick={back} disabled={!visited.length} aria-label="Previous task">
              <ArrowLeft />
            </Button>
          </Tooltip>
          <Tooltip content="Skip (→)">
            <Button size="sm" variant="secondary" onClick={() => moveTo(nextId)} disabled={!nextId}>
              Skip <ArrowRight />
            </Button>
          </Tooltip>
        </div>
      </div>

      {current && data.record ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden xl:grid-cols-[240px_minmax(0,1fr)_340px]">
          <nav aria-label="Tasks" className="thin-scroll hidden min-h-0 overflow-y-auto border-r border-line xl:block">
            {tasks.map((t) => {
              const overdue = t.dueAt && new Date(t.dueAt).getTime() < Date.now();
              return (
                <button
                  key={t.id}
                  onClick={() => moveTo(t.id)}
                  aria-current={t.id === current.id ? "true" : undefined}
                  className={cn("block w-full border-b border-line px-4 py-2 text-left text-[13px] hover:bg-surface-hover", t.id === current.id && "bg-[#e5f5f8] shadow-[inset_3px_0_0_var(--link)]")}
                >
                  <div className="truncate font-medium">{t.title}</div>
                  <div className="truncate text-[12px] text-ink-subtle">{t.contact?.name ?? t.company?.name ?? "No record"}</div>
                  <div className={cn("text-[12px]", overdue ? "text-danger" : "text-ink-subtle")}>{t.dueAt ? friendlyDateTime(t.dueAt) : "No due date"}</div>
                </button>
              );
            })}
          </nav>
          <TaskSession key={current.id} data={data} onFinished={finished} onSkip={() => moveTo(nextId)} onBack={back} />
        </div>
      ) : current ? (
        <div className="p-10 text-center text-[13px] text-ink-muted">This task isn&apos;t linked to a contact or company. Complete it from the Tasks list.</div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-center">
          <div>
            <Check className="mx-auto mb-3 size-10 text-[#00bda5]" />
            <div className="mb-1 text-[16px] font-medium">All done</div>
            <p className="text-[13px] text-ink-muted">
              No {TAB_LABEL[data.tab] ?? "open"} tasks left with these filters.{" "}
              <Link href={backHref} className="text-link hover:underline">
                Back to tasks
              </Link>
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function TaskSession({ data, onFinished, onSkip, onBack }: { data: TaskQueueData; onFinished: (message: string) => void; onSkip: () => void; onBack: () => void }) {
  const task = data.current!;
  const r = data.record!;
  const usable = r.phones.filter((p) => !["Wrong", "Disconnected"].includes(p.status));
  const firstPhone = usable.find((p) => p.own) ?? usable[0];
  const [phone, setPhone] = useState(firstPhone ? `id:${firstPhone.id}` : r.contact?.phone ? `raw:${r.contact.phone}` : "");
  const [path, setPath] = useState("");
  const [notes, setNotes] = useState("");
  const [campaignId, setCampaignId] = useState(r.campaigns.length === 1 ? r.campaigns[0].id : "");
  const [completeOnLog, setCompleteOnLog] = useState(true);
  const [followUp, setFollowUp] = useState(true);
  const [seconds, setSeconds] = useState(0);
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const notesRef = useRef<HTMLTextAreaElement>(null);
  const isCallTask = task.taskType === "Call" || r.phones.length > 0;
  const hours = inBusinessHours(r.timeZone);
  const overdue = task.dueAt && new Date(task.dueAt).getTime() < Date.now();
  const campaign = r.campaigns.find((c) => c.id === campaignId);

  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, [running]);

  async function step(fn: () => Promise<{ ok: boolean; error?: string }>, message: string) {
    if (busy) return;
    setBusy(true);
    setError(null);
    const res = await fn();
    setBusy(false);
    if (!res.ok) return setError(res.error ?? "Something went wrong");
    onFinished(message);
  }

  const logCall = (result: string) =>
    step(async () => {
      if (!r.id) return { ok: false, error: "No record to log the call on" };
      setRunning(false);
      const rule = followUp ? data.followUpRules.find((f) => f.callResult === result) : undefined;
      const res = await logActivity(r.object, r.id, {
        type: "CALL",
        callResult: result,
        callPath: path || null,
        durationSec: seconds || null,
        phoneNumberId: phone.startsWith("id:") ? phone.slice(3) : null,
        dialedNumber: phone.startsWith("raw:") ? phone.slice(4) : null,
        targetContactId: r.contact?.id ?? null,
        body: notes,
        occurredAt: new Date().toISOString(),
        campaignId: campaignId || null,
        followUp: rule ? { title: rule.taskTitle, taskType: rule.taskType, dueAt: nextLocalMorning(r.timeZone, new Date(), rule.dueInDays) } : null,
      });
      if (!res.ok) return res;
      if (completeOnLog) {
        const done = await setTasksDone([task.id], true);
        if (!done.ok) return done;
      }
      return { ok: true };
    }, `${result} logged${completeOnLog ? ", task completed" : ""}`);

  const complete = () =>
    step(async () => {
      if (notes.trim() && r.id) {
        const res = await logActivity(r.object, r.id, { type: "NOTE", body: notes, occurredAt: new Date().toISOString() });
        if (!res.ok) return res;
      }
      return setTasksDone([task.id], true);
    }, notes.trim() ? "Note saved, task completed" : "Task completed");

  const reschedule = (to: { at?: string; days?: number }, label: string) => step(() => rescheduleTasks([task.id], to), `Moved to ${label}`);

  // Keys: 1–9/0 log an outcome, C completes, → skips, ← goes back (not while typing)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = KEYS.indexOf(e.key);
      if (isCallTask && i >= 0 && data.outcomes[i]) {
        e.preventDefault();
        void logCall(data.outcomes[i].value);
      } else if (e.key.toLowerCase() === "c") void complete();
      else if (e.key === "ArrowRight") onSkip();
      else if (e.key === "ArrowLeft") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <>
      <div className="thin-scroll min-h-0 space-y-4 overflow-y-auto px-5 py-4">
        <section className="rounded-[6px] border border-line p-4">
          <div className="flex flex-wrap items-center gap-2">
            {task.taskType && <Pill label={task.taskType} />}
            {task.priority && <Pill label={task.priority} color={task.priority === "High" ? "#f2545b" : task.priority === "Medium" ? "#f5c26b" : "#7c98b6"} />}
            <span className={cn("text-[13px]", overdue ? "font-medium text-danger" : "text-ink-muted")}>
              {task.dueAt ? `${overdue ? "Overdue · was due" : "Due"} ${friendlyDateTime(task.dueAt)}` : "No due date"}
            </span>
            {task.queue && <span className="text-[12px] text-ink-subtle">· {task.queue.name}</span>}
          </div>
          <h1 className="mt-1.5 text-[20px] font-medium">{task.title}</h1>
          {task.body && <p className="mt-1 whitespace-pre-line text-[13px] text-ink-muted">{task.body}</p>}
        </section>

        <section className="flex flex-wrap items-start gap-4 rounded-[6px] border border-line p-4">
          <div className="min-w-0 flex-1 text-[13px]">
            {r.contact ? (
              <>
                <div className="flex items-center gap-2">
                  <UserRound className="size-4 text-ink-subtle" />
                  <Link href={`/contacts/${r.contact.id}`} target="_blank" className="text-[16px] font-medium text-link hover:underline">
                    {r.contact.name}
                  </Link>
                  {r.contact.doNotCall && <Pill label="Do not call" color="#f2545b" />}
                </div>
                <div className="text-ink-muted">{[r.contact.jobTitle, r.company?.name].filter(Boolean).join(" at ")}</div>
                {r.contact.email && (
                  <a href={`mailto:${r.contact.email}`} className="mt-0.5 flex items-center gap-1 text-link hover:underline">
                    <Mail className="size-3.5" /> {r.contact.email}
                  </a>
                )}
                <div className="mt-1 text-[12px] text-ink-subtle">
                  CRT {r.contact.crtCount} · {r.contact.callStatus ?? "Never called"}
                  {r.contact.leadStatus ? ` · ${r.contact.leadStatus}` : ""}
                </div>
              </>
            ) : (
              <div className="flex items-center gap-2">
                <Building2 className="size-4 text-ink-subtle" />
                <span className="text-[16px] font-medium">{r.company?.name}</span>
              </div>
            )}
            {r.company && (
              <div className="mt-1 text-[12px] text-ink-subtle">
                <Link href={`/companies/${r.company.id}`} target="_blank" className="text-link hover:underline">
                  {r.company.name}
                </Link>
                {r.company.leadState ? ` · ${r.company.leadState}` : ""} · company CRT {r.company.crtCount}
              </div>
            )}
          </div>
          <div className={cn("rounded-[6px] border px-3 py-2 text-right", hours === false ? "border-line bg-surface-muted" : "border-[#00bda5] bg-[#e5f8f6]")}>
            <div className="text-[20px] font-medium tabular-nums">{localTime(r.timeZone) ?? "--:--"}</div>
            <div className="text-[11px] text-ink-muted">{r.timeZone ? (hours === false ? "Outside business hours" : "Business hours") : "Time zone unknown"}</div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Numbers ({r.phones.length})</h2>
          <div className="space-y-1.5">
            {r.phones.map((p) => (
              <label key={p.id} className={cn("flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2 text-[13px]", phone === `id:${p.id}` ? "border-link bg-[#f0f9fb]" : "border-line")}>
                <input type="radio" name="number" className="mt-1 accent-[var(--link)]" checked={phone === `id:${p.id}`} onChange={() => setPhone(`id:${p.id}`)} />
                <span className="min-w-0 flex-1">
                  <a
                    href={`tel:${p.number}${p.extension ? `,${p.extension}` : ""}`}
                    onClick={() => (setPhone(`id:${p.id}`), setSeconds(0), setRunning(true))}
                    className="font-medium text-link hover:underline"
                  >
                    <Phone className="mr-1 inline size-3.5" />
                    {formatPhone(p.number)}
                    {p.extension ? ` ext. ${p.extension}` : ""}
                  </a>{" "}
                  <span className="text-[12px] text-ink-muted">{p.own ? `${p.type} · their line` : p.type}</span> <Pill label={p.status} color={PHONE_STATUS_COLORS[p.status]} />
                  {p.ivrPath && <span className="block font-mono text-[12px]">IVR: {p.ivrPath}</span>}
                </span>
              </label>
            ))}
            {!r.phones.length && <p className="text-[13px] text-ink-subtle">No numbers on this record.</p>}
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[14px] font-semibold">Recent activity</h2>
          <ol className="space-y-2 border-l-2 border-line pl-3">
            {r.activities.map((a) => (
              <li key={a.id} className="text-[13px]">
                <div className="font-medium">{a.title}</div>
                <div className="text-[12px] text-ink-subtle">
                  {friendlyDateTime(a.at)}
                  {a.by ? ` · ${a.by}` : ""}
                </div>
                {a.body && <p className="line-clamp-2 text-ink-muted">{a.body}</p>}
              </li>
            ))}
            {!r.activities.length && <li className="text-[13px] text-ink-subtle">No calls, emails or notes yet.</li>}
          </ol>
        </section>
      </div>

      <aside className="thin-scroll min-h-0 space-y-3 overflow-y-auto border-t border-line bg-surface-muted px-4 py-4 lg:border-l lg:border-t-0">
        {campaign?.pitch && (
          <details open className="rounded-[4px] border border-line bg-surface px-3 py-2 text-[13px]">
            <summary className="cursor-pointer font-semibold">Campaign pitch</summary>
            <p className="mt-1 max-h-[140px] overflow-y-auto whitespace-pre-line text-ink-muted">{campaign.pitch}</p>
          </details>
        )}
        <textarea
          ref={notesRef}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={4}
          placeholder={isCallTask ? "Call notes" : "Notes (saved to the timeline when you complete)"}
          aria-label="Notes"
          className="w-full rounded-[3px] border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-link focus:outline-none"
        />
        {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

        {isCallTask && (
          <div className="space-y-2 rounded-[4px] border border-line bg-surface p-3 text-[13px]">
            <div className="flex items-center justify-between">
              <span className="font-semibold">Log the call</span>
              <button className="flex items-center gap-1 text-[12px] text-ink-muted" onClick={() => setRunning((x) => !x)} aria-label={running ? "Pause timer" : "Start timer"}>
                <Timer className="size-3.5" />
                <span className="font-mono tabular-nums">
                  {Math.floor(seconds / 60)}:{String(seconds % 60).padStart(2, "0")}
                </span>
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Select value={path} onChange={(e) => setPath(e.target.value)} aria-label="Call path" className="h-8">
                <option value="">Path --</option>
                {data.paths.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
              <Select value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign" className="h-8" disabled={!r.campaigns.length}>
                <option value="">{r.campaigns.length ? "No campaign" : "Not in a campaign"}</option>
                {r.campaigns.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-1.5">
              {data.outcomes.map((o, i) => (
                <button
                  key={o.value}
                  disabled={busy}
                  onClick={() => void logCall(o.value)}
                  className={cn("flex min-h-9 items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-left text-[12.5px] font-medium disabled:opacity-50", outcomeTone(o.value))}
                >
                  {KEYS[i] && <kbd className="rounded border border-current/30 px-1 font-mono text-[10px] opacity-70">{KEYS[i]}</kbd>}
                  <span>{o.label}</span>
                </button>
              ))}
            </div>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" className="accent-[var(--link)]" checked={completeOnLog} onChange={(e) => setCompleteOnLog(e.target.checked)} />
              Complete this task when I log the call
            </label>
            <label className="flex items-center gap-2 text-[12px]">
              <input type="checkbox" className="accent-[var(--link)]" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
              Create follow-ups from the follow-up rules
            </label>
          </div>
        )}

        <Button variant="primary" className="w-full" disabled={busy} onClick={() => void complete()}>
          <Check /> {notes.trim() ? "Save note and complete" : "Complete task"} <kbd className="ml-1 font-mono text-[10px] opacity-70">C</kbd>
        </Button>
        <div className="rounded-[4px] border border-line bg-surface p-3 text-[13px]">
          <div className="mb-1.5 font-medium">Not now</div>
          <div className="flex flex-wrap gap-1.5">
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reschedule({ days: 1 }, "tomorrow")}>
              +1 day
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reschedule({ at: nextLocalMorning(r.timeZone) }, "their next working morning")}>
              Their next morning
            </Button>
            <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reschedule({ days: 7 }, "next week")}>
              +1 week
            </Button>
          </div>
        </div>
        <p className="text-[11px] text-ink-subtle">Keys: {isCallTask ? "1–9, 0 log an outcome · " : ""}C completes · → skip · ← previous</p>
      </aside>
    </>
  );
}
