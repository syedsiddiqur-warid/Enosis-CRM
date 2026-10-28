"use client";

import { Minus, X } from "lucide-react";
import { useEffect, useMemo, useState, useTransition } from "react";
import { Button, Input, Select } from "@/components/ui/button";
import { fromLocalInput, toLocalInput } from "@/lib/crm/dates";
import { logActivity, updateActivity } from "@/lib/crm/record-actions";
import type { ActivityInput, ComposerKind, RecordActivity } from "@/lib/crm/record-types";
import type { PropOption } from "@/lib/crm/types";
import { cn, formatPhone } from "@/lib/utils";
import { useRecord } from "./record-context";

const TITLES: Record<ComposerKind, string> = { note: "Note", email: "Log email", call: "Log call", task: "Task", meeting: "Log meeting" };
const TYPE: Record<ComposerKind, ActivityInput["type"]> = { note: "NOTE", email: "EMAIL", call: "CALL", task: "TASK", meeting: "MEETING" };

const nowLocal = () => toLocalInput(new Date());
const inLocal = (days: number, hour?: number) => {
  const d = new Date(Date.now() + days * 864e5);
  const s = toLocalInput(d);
  return hour === undefined ? s : `${s.slice(0, 10)}T${String(hour).padStart(2, "0")}:00`;
};
const list = (s: string) =>
  s
    .split(/[,;\s]+/)
    .map((x) => x.trim())
    .filter(Boolean);

/** Floating bottom-right composer, like HubSpot's. Logs a new activity or edits `editing`. */
export function Composer({ kind, editing, preset, onClose }: { kind: ComposerKind; editing?: RecordActivity; preset?: Partial<RecordActivity>; onClose: () => void }) {
  const { data, toast, refresh } = useRecord();
  const [minimized, setMinimized] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const src = editing ?? preset;
  const local = (v: string | null | undefined, fallback: string) => (v ? toLocalInput(v) : fallback);
  const liveCampaigns = data.campaigns.filter((c) => c.campaignStatus === "ACTIVE" || c.campaignStatus === "PAUSED");

  // One flat form state; each composer reads the fields it needs
  const [f, setF] = useState(() => ({
    body: src?.body ?? "",
    occurredAt: local(src?.occurredAt, nowLocal()),
    subject: src?.subject ?? "",
    emailTo: (src?.emailTo ?? (data.header.email && data.object === "CONTACT" ? [data.header.email] : [])).join(", "),
    emailCc: (src?.emailCc ?? []).join(", "),
    emailDirection: (src?.emailDirection ?? "OUTBOUND") as "INBOUND" | "OUTBOUND",
    phone: src?.phoneNumberId ? `id:${src.phoneNumberId}` : src?.dialedNumber ? `raw:${src.dialedNumber}` : data.phones[0] ? `id:${data.phones[0].id}` : data.header.phone ? `raw:${data.header.phone}` : "",
    targetContactId: src?.targetContact?.id ?? "",
    callResult: src?.callResult ?? "",
    callPath: src?.callPath ?? "",
    gatekeeperType: src?.gatekeeperType ?? "",
    durationMin: src?.durationSec ? String(Math.round((src.durationSec / 60) * 10) / 10) : "",
    title: src?.title ?? "",
    taskType: src?.taskType ?? "Call",
    priority: src?.priority ?? "",
    assigneeId: src?.assigneeId ?? data.currentUserId,
    dueAt: local(src?.dueAt, inLocal(1, 10)),
    reminder: "none",
    startAt: local(src?.startAt, inLocal(1, 11)),
    endAt: local(src?.endAt, `${inLocal(1).slice(0, 10)}T11:30`),
    attendees: (src?.attendees ?? []).join(", "),
    location: src?.location ?? "",
    meetingType: src?.meetingType ?? "",
    meetingOutcome: src?.meetingOutcome ?? (kind === "meeting" ? "Scheduled" : ""),
    followUp: false,
    followUpTitle: "",
    followUpType: "Call",
    followUpDue: inLocal(3, 10),
    // Credit the call/meeting to the campaign the company is being worked in (the only live one by default)
    campaignId: src?.campaign?.id ?? (liveCampaigns.length === 1 ? liveCampaigns[0].campaignId : ""),
  }));
  const set = <K extends keyof typeof f>(k: K, v: (typeof f)[K]) => setF((x) => ({ ...x, [k]: v }));

  // Follow-up rules (Settings → Activities): an outcome suggests a task due in N days
  const rule = useMemo(() => data.followUpRules.find((r) => r.callResult === f.callResult), [data.followUpRules, f.callResult]);
  useEffect(() => {
    if (kind !== "call" || editing) return;
    setF((x) =>
      rule
        ? { ...x, followUp: true, followUpTitle: rule.taskTitle, followUpType: rule.taskType, followUpDue: inLocal(rule.dueInDays, 10) }
        : { ...x, followUp: false },
    );
  }, [rule, kind, editing]);

  function build(): ActivityInput {
    const type = TYPE[kind];
    const followUp = !editing && f.followUp && (kind === "note" || kind === "call") ? { title: f.followUpTitle || "Follow up", taskType: f.followUpType, dueAt: fromLocalInput(f.followUpDue) } : null;
    switch (kind) {
      case "note":
        return { type, body: f.body, occurredAt: fromLocalInput(f.occurredAt), followUp };
      case "email":
        return { type, subject: f.subject, body: f.body, emailTo: list(f.emailTo), emailCc: list(f.emailCc), emailDirection: f.emailDirection, occurredAt: fromLocalInput(f.occurredAt) };
      case "call":
        return {
          type,
          callResult: f.callResult,
          callPath: f.callPath || null,
          gatekeeperType: /gatekeeper/i.test(f.callResult) ? f.gatekeeperType || null : null,
          durationSec: f.durationMin ? Number(f.durationMin) * 60 : null,
          phoneNumberId: f.phone.startsWith("id:") ? f.phone.slice(3) : null,
          dialedNumber: f.phone.startsWith("raw:") ? f.phone.slice(4) : null,
          targetContactId: f.targetContactId || null,
          body: f.body,
          occurredAt: fromLocalInput(f.occurredAt),
          followUp,
          campaignId: f.campaignId || null,
        };
      case "task": {
        const due = fromLocalInput(f.dueAt);
        const offset = { none: null, due: 0, "30m": 30 * 60e3, "1d": 864e5 }[f.reminder as "none" | "due" | "30m" | "1d"];
        return {
          type,
          title: f.title,
          body: f.body,
          taskType: f.taskType,
          priority: f.priority || null,
          assigneeId: f.assigneeId,
          dueAt: due,
          reminderAt: offset === null ? null : new Date(new Date(due).getTime() - offset).toISOString(),
        };
      }
      case "meeting":
        return {
          type,
          title: f.title,
          body: f.body,
          startAt: fromLocalInput(f.startAt),
          endAt: f.endAt ? fromLocalInput(f.endAt) : null,
          attendees: list(f.attendees),
          location: f.location,
          meetingType: f.meetingType || null,
          meetingOutcome: f.meetingOutcome || null,
          campaignId: f.campaignId || null,
        };
    }
  }
  const campaign = liveCampaigns.find((c) => c.campaignId === f.campaignId);

  function submit() {
    start(async () => {
      setError(null);
      const input = build();
      if (editing) {
        const res = await updateActivity(data.object, data.id, editing.id, input);
        if (!res.ok) return setError(res.error);
        toast({ message: `${TITLES[kind].replace(/^Log /, "")} updated` });
      } else {
        const res = await logActivity(data.object, data.id, input);
        if (!res.ok) return setError(res.error);
        const auto = res.data!.automations;
        toast({
          message: `${TITLES[kind].replace(/^Log /, "").replace(/^./, (c) => c.toUpperCase())} ${kind === "task" ? "created" : "logged"}${input.followUp ? " with a follow-up task" : ""}${auto.length ? `. Automation: ${auto.join(", ")}` : ""}`,
        });
      }
      refresh();
      onClose();
    });
  }

  const options = (opts: PropOption[], placeholder?: string) => (
    <>
      {placeholder !== undefined && <option value="">{placeholder}</option>}
      {opts.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </>
  );

  return (
    <div
      role="dialog"
      aria-label={TITLES[kind]}
      className={cn("fixed bottom-0 right-6 z-40 flex w-[560px] max-w-[calc(100vw-32px)] flex-col rounded-t-[6px] border border-line bg-surface shadow-[0_0_24px_rgba(45,62,80,0.3)]", !minimized && "max-h-[82vh]")}
      onKeyDown={(e) => {
        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) submit();
      }}
    >
      <div className="flex items-center gap-2 rounded-t-[6px] bg-[#2d3e50] px-4 py-2.5 text-white">
        <span className="flex-1 text-[14px] font-medium">
          {editing ? `Edit ${TITLES[kind].replace(/^Log /, "").toLowerCase()}` : TITLES[kind]}
          <span className="font-normal opacity-70"> · {data.header.name}</span>
        </span>
        <button className="rounded p-1 hover:bg-white/10" onClick={() => setMinimized((m) => !m)} aria-label={minimized ? "Expand" : "Minimize"}>
          <Minus className="size-4" />
        </button>
        <button className="rounded p-1 hover:bg-white/10" onClick={onClose} aria-label="Close">
          <X className="size-4" />
        </button>
      </div>
      {!minimized && (
        <>
          <div className="thin-scroll flex-1 space-y-3 overflow-y-auto px-5 py-4 text-[13px]">
            {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-danger">{error}</p>}

            {(kind === "call" || kind === "meeting") && liveCampaigns.length > 0 && !editing && (
              <div className="rounded-[4px] border border-line bg-surface-muted px-3 py-2.5">
                <Field label="Campaign">
                  <Select value={f.campaignId} onChange={(e) => set("campaignId", e.target.value)}>
                    <option value="">Not part of a campaign</option>
                    {liveCampaigns.map((c) => (
                      <option key={c.campaignId} value={c.campaignId}>
                        {c.name} ({c.status}
                        {c.attempts ? `, ${c.attempts} calls so far` : ""})
                      </option>
                    ))}
                  </Select>
                </Field>
                {campaign?.pitch && kind === "call" && (
                  <details className="mt-2 text-[12px]">
                    <summary className="cursor-pointer font-medium text-link">Campaign pitch</summary>
                    <p className="mt-1 whitespace-pre-line text-ink-muted">{campaign.pitch}</p>
                  </details>
                )}
              </div>
            )}

            {kind === "call" && (
              <div className="grid grid-cols-2 gap-3">
                {data.object === "COMPANY" && (
                  <Field label="Contacted" className="col-span-2">
                    <Select value={f.targetContactId} onChange={(e) => set("targetContactId", e.target.value)} disabled={!!editing}>
                      <option value="">No specific contact (company line)</option>
                      {data.contacts.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                          {c.jobTitle ? ` – ${c.jobTitle}` : ""}
                        </option>
                      ))}
                    </Select>
                  </Field>
                )}
                <Field label="Number dialed" className="col-span-2">
                  <Select value={f.phone} onChange={(e) => set("phone", e.target.value)} disabled={!!editing}>
                    <option value="">Not recorded</option>
                    {data.phones.map((p) => (
                      <option key={p.id} value={`id:${p.id}`}>
                        {formatPhone(p.number)} · {p.type}
                        {p.ivrPath ? ` · ${p.ivrPath}` : ""}
                        {p.status !== "Valid" && p.status !== "Unknown" ? ` (${p.status})` : ""}
                      </option>
                    ))}
                    {data.header.phone && !data.phones.some((p) => p.number === data.header.phone) && <option value={`raw:${data.header.phone}`}>{formatPhone(data.header.phone)} · record phone</option>}
                    {editing?.dialedNumber && !editing.phoneNumberId && <option value={`raw:${editing.dialedNumber}`}>{formatPhone(editing.dialedNumber)}</option>}
                  </Select>
                </Field>
                <Field label="Call outcome *">
                  <Select value={f.callResult} onChange={(e) => set("callResult", e.target.value)} autoFocus aria-required>
                    {options(data.options.callResult, "Choose an outcome")}
                  </Select>
                </Field>
                <Field label="Call path">
                  <Select value={f.callPath} onChange={(e) => set("callPath", e.target.value)}>
                    {options(data.options.callPath, "--")}
                  </Select>
                </Field>
                {/gatekeeper/i.test(f.callResult) && (
                  <Field label="Gatekeeper type">
                    <Select value={f.gatekeeperType} onChange={(e) => set("gatekeeperType", e.target.value)}>
                      {options(data.options.gatekeeperType, "--")}
                    </Select>
                  </Field>
                )}
                <Field label="Duration (minutes)">
                  <Input type="number" min={0} step={0.5} value={f.durationMin} onChange={(e) => set("durationMin", e.target.value)} />
                </Field>
                <Field label="Date and time">
                  <Input type="datetime-local" value={f.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
                </Field>
              </div>
            )}

            {kind === "email" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Direction">
                  <Select value={f.emailDirection} onChange={(e) => set("emailDirection", e.target.value as "INBOUND" | "OUTBOUND")}>
                    <option value="OUTBOUND">Sent (outbound)</option>
                    <option value="INBOUND">Received (inbound)</option>
                  </Select>
                </Field>
                <Field label="Date and time">
                  <Input type="datetime-local" value={f.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
                </Field>
                <Field label="To" className="col-span-2">
                  <Input value={f.emailTo} onChange={(e) => set("emailTo", e.target.value)} placeholder="name@company.com, …" />
                </Field>
                <Field label="Cc" className="col-span-2">
                  <Input value={f.emailCc} onChange={(e) => set("emailCc", e.target.value)} />
                </Field>
                <Field label="Subject" className="col-span-2">
                  <Input value={f.subject} onChange={(e) => set("subject", e.target.value)} autoFocus />
                </Field>
              </div>
            )}

            {(kind === "task" || kind === "meeting") && (
              <Field label={kind === "task" ? "Task title *" : "Meeting title *"}>
                <Input value={f.title} onChange={(e) => set("title", e.target.value)} autoFocus placeholder={kind === "task" ? "e.g. Call back after lunch" : "e.g. Discovery call"} />
              </Field>
            )}

            {kind === "task" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Due date *">
                  <Input type="datetime-local" value={f.dueAt} onChange={(e) => set("dueAt", e.target.value)} />
                </Field>
                <Field label="Reminder">
                  <Select value={f.reminder} onChange={(e) => set("reminder", e.target.value)}>
                    <option value="none">No reminder</option>
                    <option value="due">At the due time</option>
                    <option value="30m">30 minutes before</option>
                    <option value="1d">1 day before</option>
                  </Select>
                </Field>
                <Field label="Type">
                  <Select value={f.taskType} onChange={(e) => set("taskType", e.target.value)}>
                    {options(data.options.taskType)}
                  </Select>
                </Field>
                <Field label="Priority">
                  <Select value={f.priority} onChange={(e) => set("priority", e.target.value)}>
                    {options(data.options.taskPriority, "None")}
                  </Select>
                </Field>
                <Field label="Assigned to" className="col-span-2">
                  <Select value={f.assigneeId} onChange={(e) => set("assigneeId", e.target.value)}>
                    {data.users.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.name ?? u.email}
                        {u.id === data.currentUserId ? " (me)" : ""}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            )}

            {kind === "meeting" && (
              <div className="grid grid-cols-2 gap-3">
                <Field label="Start *">
                  <Input type="datetime-local" value={f.startAt} onChange={(e) => set("startAt", e.target.value)} />
                </Field>
                <Field label="End">
                  <Input type="datetime-local" value={f.endAt} onChange={(e) => set("endAt", e.target.value)} />
                </Field>
                <Field label="Type">
                  <Select value={f.meetingType} onChange={(e) => set("meetingType", e.target.value)}>
                    {options(data.options.meetingType, "--")}
                  </Select>
                </Field>
                <Field label="Outcome">
                  <Select value={f.meetingOutcome} onChange={(e) => set("meetingOutcome", e.target.value)}>
                    {options(data.options.meetingOutcome, "--")}
                  </Select>
                </Field>
                <Field label="Location or link" className="col-span-2">
                  <Input value={f.location} onChange={(e) => set("location", e.target.value)} placeholder="Zoom, Teams or an address" />
                </Field>
                <Field label="Attendees (emails)" className="col-span-2">
                  <Input value={f.attendees} onChange={(e) => set("attendees", e.target.value)} placeholder="name@company.com, …" />
                </Field>
              </div>
            )}

            {kind === "note" && (
              <Field label="Date and time" className="w-[220px]">
                <Input type="datetime-local" value={f.occurredAt} onChange={(e) => set("occurredAt", e.target.value)} />
              </Field>
            )}

            <Field label={kind === "note" ? "Note *" : kind === "email" ? "Body" : kind === "call" ? "Call notes" : "Notes"}>
              <textarea
                value={f.body}
                onChange={(e) => set("body", e.target.value)}
                rows={kind === "note" ? 8 : 4}
                autoFocus={kind === "note"}
                placeholder={kind === "call" ? "What happened on the call? Who answered, what they said, next steps" : "Start typing…"}
                className="w-full resize-y rounded-[3px] border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-link focus:outline-none"
              />
            </Field>

            {!editing && (kind === "note" || kind === "call") && (
              <div className="rounded-[4px] border border-line bg-surface-muted px-3 py-2.5">
                <label className="flex cursor-pointer items-center gap-2">
                  <input type="checkbox" className="accent-[var(--link)]" checked={f.followUp} onChange={(e) => set("followUp", e.target.checked)} />
                  Create a follow-up task
                  {rule && kind === "call" && <span className="text-[12px] text-ink-subtle">(suggested for “{f.callResult}”)</span>}
                </label>
                {f.followUp && (
                  <div className="mt-2 grid grid-cols-[1fr_120px_180px] gap-2">
                    <Input value={f.followUpTitle} onChange={(e) => set("followUpTitle", e.target.value)} placeholder="Follow up" aria-label="Follow-up task title" />
                    <Select value={f.followUpType} onChange={(e) => set("followUpType", e.target.value)} aria-label="Follow-up task type">
                      {options(data.options.taskType)}
                    </Select>
                    <Input type="datetime-local" value={f.followUpDue} onChange={(e) => set("followUpDue", e.target.value)} aria-label="Follow-up due date" />
                  </div>
                )}
              </div>
            )}
          </div>
          <div className="flex items-center gap-2 border-t border-line px-5 py-3">
            <Button variant="primary" onClick={submit} disabled={pending}>
              {editing ? "Save" : kind === "task" ? "Create task" : kind === "note" ? "Create note" : `Log ${kind}`}
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <span className="ml-auto text-[12px] text-ink-subtle">Ctrl+Enter to save</span>
          </div>
        </>
      )}
    </div>
  );
}

/** Wrapping <label> associates the caption with its control. */
function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[12px] font-medium text-ink">{label}</span>
      {children}
    </label>
  );
}
