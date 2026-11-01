"use client";

import { ArrowLeft, ArrowRight, ChevronLeft, Clock, ExternalLink, FlaskConical, NotebookPen, Pencil, Phone, PhoneCall, Plus, X } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { CompanyLogo, LocalTime, Pill } from "@/components/index/values";
import { Button, Input, Select } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/overlays";
import { BUCKET_LABEL, inBusinessHours, nextLocalMorning } from "@/lib/crm/calling-queue";
import type { QueueCompany, QueueData } from "@/lib/crm/calling-queue-loader";
import { formatDate, friendlyDateTime, fromLocalInput, toLocalInput } from "@/lib/crm/dates";
import { CONVERSATION_OUTCOMES, FEEDBACK_RATINGS, FEEDBACK_TAGS, FOLLOW_GROUP_INFO, type FollowGroup } from "@/lib/crm/follow-up";
import { moveCompanyNumber, setPhoneNotes, type NumberSource } from "@/lib/crm/phone-actions";
import { logActivity } from "@/lib/crm/record-actions";
import { cn, formatPhone } from "@/lib/utils";
import { ContactDialog, EditCompanyDialog, NumberDialog, ResearchPanel, ResearchRequestDialog } from "./caller-tools";

type Toast = { message: string };
const KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0"];
const PHONE_STATUS_COLORS: Record<string, string> = { Valid: "#00bda5", "Temp Busy": "#f5c26b", Wrong: "#f2545b", Disconnected: "#f2545b", Unknown: "#cbd6e2" };

/** Button colour for an outcome: reached someone (green), meeting (teal), negative (red), the rest neutral. */
function outcomeTone(result: string) {
  if (result === "Meeting Booked") return "border-[#0091ae] bg-[#e5f5f8] text-[#006e84] hover:bg-[#d0eef3]";
  if (/interested$/i.test(result) && !/not/i.test(result)) return "border-[#00bda5] bg-[#e5f8f6] text-[#00806e] hover:bg-[#d2f3ef]";
  if (/not interested|wrong number/i.test(result)) return "border-[#f2545b]/60 bg-[#fde8e9] text-[#c93a41] hover:bg-[#fbd7d9]";
  if (/callback/i.test(result)) return "border-[#6a78d1]/60 bg-[#eef0fb] text-[#4b58b0] hover:bg-[#e2e5f7]";
  return "border-line-strong bg-surface hover:bg-surface-hover";
}

function duration(sec: number) {
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`;
}

export function CallingQueue({ data }: { data: QueueData }) {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const [pending, startTransition] = useTransition();
  const [toast, setToast] = useState<Toast | null>(null);
  const [visited, setVisited] = useState<string[]>([]);
  const { queue, current } = data;
  const index = current ? queue.findIndex((q) => q.companyId === current.id) : -1;
  const ready = queue.filter((q) => q.bucket !== "scheduled").length;

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 7000);
    return () => clearTimeout(t);
  }, [toast]);

  const go = useCallback(
    (patch: Record<string, string | null>) => {
      const p = new URLSearchParams(sp.toString());
      for (const [k, v] of Object.entries(patch)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      startTransition(() => router.replace(`${pathname}?${p.toString()}`, { scroll: false }));
    },
    [sp, pathname, router],
  );

  /** The company after the current one (wrapping), or null when it's the only one. */
  const nextId = useMemo(() => {
    if (index < 0 || queue.length < 2) return null;
    return queue[(index + 1) % queue.length].companyId;
  }, [queue, index]);

  const moveTo = useCallback(
    (id: string | null) => {
      if (current) setVisited((v) => [...v, current.id]);
      go({ id });
    },
    [current, go],
  );
  const back = useCallback(() => {
    const prev = visited.at(-1);
    if (!prev) return;
    setVisited((v) => v.slice(0, -1));
    go({ id: prev });
  }, [visited, go]);

  return (
    <div className="flex h-full min-h-[560px] flex-col overflow-hidden rounded-[6px] border border-line bg-surface">
      {pending && <div className="h-0.5 w-full animate-pulse bg-link" />}
      {/* Session bar */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-line px-5 py-2.5">
        <Link href="/prospecting" className="flex items-center gap-1 text-[13px] text-link hover:underline">
          <ChevronLeft className="size-4" /> Calling queue
        </Link>
        <Link href={`/campaigns/${data.campaign.id}`} className="min-w-0 truncate text-[15px] font-medium hover:underline">
          {data.campaign.name}
        </Link>
        {data.campaign.status !== "ACTIVE" && <Pill label={data.campaign.status.toLowerCase()} color="#f5c26b" />}
        <Select className="h-8 w-[170px]" value={data.caller} onChange={(e) => go({ caller: e.target.value, id: null })} aria-label="Whose companies">
          <option value="me">My companies</option>
          <option value="unassigned">Unassigned</option>
          <option value="all">Everyone&apos;s</option>
          {data.users
            .filter((u) => u.id !== data.currentUserId)
            .map((u) => (
              <option key={u.id} value={u.id}>
                {u.name ?? u.email}
              </option>
            ))}
        </Select>
        <label className="flex cursor-pointer items-center gap-1.5 text-[13px]">
          <input type="checkbox" className="accent-[var(--link)]" checked={data.hoursOnly} onChange={(e) => go({ hours: e.target.checked ? "1" : null, id: null })} />
          Only their business hours now
        </label>
        <div className="ml-auto flex items-center gap-2 text-[13px]">
          {queue.length > 0 && (
            <span className="text-ink-muted">
              {index + 1} of {queue.length} · {ready} ready
            </span>
          )}
          <Tooltip content="Previous company (←)">
            <Button size="sm" variant="ghost" onClick={back} disabled={!visited.length} aria-label="Previous company">
              <ArrowLeft />
            </Button>
          </Tooltip>
          <Tooltip content="Skip without logging (→)">
            <Button size="sm" variant="secondary" onClick={() => moveTo(nextId)} disabled={!nextId}>
              Skip <ArrowRight />
            </Button>
          </Tooltip>
        </div>
      </div>

      {current ? (
        <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto lg:grid-cols-[minmax(0,1fr)_340px] lg:overflow-hidden xl:grid-cols-[250px_minmax(0,1fr)_340px]">
          <QueueList data={data} onPick={(id) => moveTo(id)} />
          <Session
            key={current.id}
            data={data}
            company={current}
            hasNext={!!nextId}
            onLogged={(message) => {
              setToast({ message });
              // Stay on this company (pinned in the URL, since logging can reorder the queue): the caller moves on with Next company
              go({ id: current.id });
            }}
            onSnoozed={(message) => {
              setToast({ message: `${message}. Click Next company when you're done here.` });
              go({ id: current.id });
            }}
            onChanged={(message) => {
              setToast({ message });
              router.refresh();
            }}
            onSkip={() => nextId && moveTo(nextId)}
            onBack={back}
          />
        </div>
      ) : (
        <div className="flex flex-1 items-center justify-center p-10 text-center">
          <div>
            <PhoneCall className="mx-auto mb-3 size-10 text-ink-subtle" strokeWidth={1.5} />
            <div className="mb-1 text-[16px] font-medium">Nothing left to call here</div>
            <p className="max-w-sm text-[13px] text-ink-muted">
              {data.hoursOnly
                ? "No open companies are in their business hours right now. Clear the business-hours filter to see the rest."
                : data.caller === "me"
                  ? "Every company assigned to you is worked. Try the unassigned companies, or ask the campaign owner to distribute more."
                  : "Every company in this view has a final outcome."}
            </p>
          </div>
        </div>
      )}

      {toast && (
        <div role="status" className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg">
          {toast.message}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}

function QueueList({ data, onPick }: { data: QueueData; onPick: (id: string) => void }) {
  const activeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest" });
  }, [data.current?.id]);
  let lastBucket = "";
  return (
    <nav aria-label="Queue" className="thin-scroll hidden min-h-0 overflow-y-auto border-r border-line xl:block">
      {data.queue.map((q) => {
        const heading = q.bucket !== lastBucket ? BUCKET_LABEL[q.bucket] : null;
        lastBucket = q.bucket;
        const active = q.companyId === data.current?.id;
        return (
          <div key={q.companyId}>
            {heading && <div className="sticky top-0 z-10 bg-surface-muted px-4 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-ink-subtle">{heading}</div>}
            <button
              ref={active ? activeRef : undefined}
              onClick={() => onPick(q.companyId)}
              aria-current={active ? "true" : undefined}
              className={cn("block w-full border-b border-line px-4 py-2 text-left text-[13px] hover:bg-surface-hover", active && "bg-[#e5f5f8] shadow-[inset_3px_0_0_var(--link)]")}
            >
              <div className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate font-medium">{q.name}</span>
                {q.followGroup && (
                  <Tooltip content={`${q.followGroup} · follow-up score ${q.followScore}`}>
                    <span className="shrink-0 rounded-full px-1.5 text-[11px] font-semibold text-white" style={{ background: FOLLOW_GROUP_INFO[q.followGroup as FollowGroup]?.color ?? "#99afc4" }}>
                      {q.followScore}
                    </span>
                  </Tooltip>
                )}
                {q.inHours === false && (
                  <Tooltip content="Outside their business hours">
                    <Clock className="size-3.5 shrink-0 text-ink-subtle" />
                  </Tooltip>
                )}
              </div>
              <div className="flex gap-2 text-[12px] text-ink-subtle">
                {q.timeZone ? <LocalTime tz={q.timeZone} /> : <span>--</span>}
                <span>
                  {q.attempts} call{q.attempts === 1 ? "" : "s"}
                </span>
                {q.lastResult && <span className="truncate">{q.lastResult}</span>}
              </div>
              {q.researchBack ? (
                <div className="text-[12px] font-medium text-[#00806e]">Research is back</div>
              ) : q.researchOpen ? (
                <div className="text-[12px] text-[#b07a1b]">Waiting on research</div>
              ) : (
                q.nextActionAt && <div className={cn("text-[12px]", q.bucket === "due" ? "text-danger" : "text-ink-subtle")}>Next: {friendlyDateTime(q.nextActionAt)}</div>
              )}
            </button>
          </div>
        );
      })}
    </nav>
  );
}

function Session({
  data,
  company: c,
  hasNext,
  onLogged,
  onSnoozed,
  onChanged,
  onSkip,
  onBack,
}: {
  data: QueueData;
  company: QueueCompany;
  hasNext: boolean;
  onLogged: (message: string) => void;
  onSnoozed: (message: string) => void;
  onChanged: (message: string) => void;
  onSkip: () => void;
  onBack: () => void;
}) {
  const forPeople = data.campaign.audience === "CONTACT";
  // Contact campaigns: only the people on the campaign's list, minus those already finished
  const callable = c.contacts.filter((x) => !x.doNotCall && (!forPeople || (x.target && !x.target.done)));
  const listed = forPeople ? c.contacts.filter((x) => x.target) : c.contacts;
  const others = forPeople ? c.contacts.filter((x) => !x.target) : [];
  const usablePhone = (contactId: string | null) =>
    c.phones.find((p) => p.contactId === contactId && !["Wrong", "Disconnected"].includes(p.status)) ?? c.phones.find((p) => !p.contactId && !["Wrong", "Disconnected"].includes(p.status));
  // Who was already called in this campaign in the last 12 hours (latest outcome each), so a reload doesn't lose track
  const recent: Record<string, string> = {};
  for (const a of c.calls) {
    if (a.thisCampaign && Date.now() - new Date(a.at).getTime() < 12 * 36e5 && !((a.contactId ?? "") in recent)) recent[a.contactId ?? ""] = a.result ?? "Call";
  }
  const fresh = callable.filter((x) => !(x.id in recent));
  // Start with a decision maker nobody has tried yet
  const firstContact = fresh.find((x) => x.labels.includes("Decision maker")) ?? fresh[0] ?? callable.find((x) => x.labels.includes("Decision maker")) ?? callable[0] ?? null;
  /** One selection at a time: a person's own number (saved line, then the number on their record), or nothing */
  const numberFor = (id: string) => {
    const own = c.phones.find((p) => p.contactId === id && !["Wrong", "Disconnected"].includes(p.status));
    const x = c.contacts.find((p) => p.id === id);
    const raw = x?.phone ?? x?.mobile;
    return own ? `id:${own.id}` : raw ? `raw:${raw}` : "";
  };
  const companyLine = usablePhone(null);
  const companyFirst = companyLine && !companyLine.contactId ? `id:${companyLine.id}` : c.phone ? `raw:${c.phone}` : "";

  const [contactId, setContactId] = useState(firstContact?.id ?? "");
  const [phone, setPhone] = useState(firstContact ? numberFor(firstContact.id) : companyFirst);
  const [gatekeeper, setGatekeeper] = useState("");
  const [notes, setNotes] = useState("");
  const [followUp, setFollowUp] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The call being filled in: outcome → notes → next call date, then Submit
  const [outcome, setOutcome] = useState<string | null>(null);
  const [nextAt, setNextAt] = useState("");
  const [feedback, setFeedback] = useState<Feedback>({ rating: null, tags: [], revisitAt: null });
  // The number whose note is being edited
  const [noteFor, setNoteFor] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");
  // Outcomes per person ("" = the company line): recent calls plus what was logged on this visit
  const [triedNow, setTried] = useState<Record<string, string>>({});
  const tried = { ...recent, ...triedNow };
  const untried = callable.filter((x) => !(x.id in tried));
  // Mid-call fix-ups and research requests
  const [dialog, setDialog] = useState<
    | { kind: "company" }
    | { kind: "contact"; contact: QueueCompany["contacts"][number] | null }
    | { kind: "number"; phone: QueueCompany["phones"][number] | null; extension?: boolean }
    | { kind: "research"; contactId?: string | null }
    | null
  >(null);
  const changed = (message: string) => {
    setDialog(null);
    onChanged(message);
  };

  const contact = c.contacts.find((x) => x.id === contactId) ?? null;
  const hours = inBusinessHours(c.timeZone);
  // Contact campaigns count attempts per person: the company is "maxed" once every targeted person is done
  const maxed = forPeople ? listed.length > 0 && listed.every((x) => x.target!.done) : !!data.campaign.maxAttempts && (c.member?.attempts ?? 0) >= data.campaign.maxAttempts;
  const journey = data.journeyOptions.find((o) => o.value === c.leadState);

  function dial(p: string) {
    setPhone(p);
  }

  // Unsent notes survive moving to another company or a reload
  const draftKey = `queue:note:${c.id}`;
  useEffect(() => {
    try {
      const draft = localStorage.getItem(draftKey);
      if (draft) setNotes(draft);
    } catch {}
  }, [draftKey]);
  useEffect(() => {
    try {
      if (notes.trim()) localStorage.setItem(draftKey, notes);
      else localStorage.removeItem(draftKey);
    } catch {}
  }, [draftKey, notes]);

  /** A note without a call: what the caller learned, e.g. from the website or a colleague. */
  async function saveNote() {
    if (busy || !notes.trim()) return;
    setBusy(true);
    setError(null);
    const res = await logActivity("COMPANY", c.id, { type: "NOTE", body: notes.trim(), occurredAt: new Date().toISOString() });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setNotes("");
    onChanged(`Note saved on ${c.name}`);
  }

  const conversation = !!outcome && CONVERSATION_OUTCOMES.includes(outcome);
  const notNow = conversation && feedback.tags.includes("not_now");
  const nextIso = nextAt ? fromLocalInput(nextAt) : null;
  const pastNext = !!nextIso && new Date(nextIso).getTime() < Date.now() - 6e4;
  /** "Mon, Nov 2, 9:30 AM their time (Today 9:30 PM yours)" */
  const whenBoth = (iso: string) =>
    c.timeZone
      ? `${new Date(iso).toLocaleString("en-US", { timeZone: c.timeZone, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} their time (${friendlyDateTime(iso)} yours)`
      : friendlyDateTime(iso);
  const canSubmit = !!outcome && !busy && !pastNext && !(notNow && !nextIso);

  /** Log the call with everything filled in, then stay on this company for its next person. */
  async function submit() {
    if (!outcome || !canSubmit) return;
    const result = outcome;
    const withFeedback: Feedback | null = conversation ? { ...feedback, revisitAt: notNow ? nextIso : null } : null;
    setBusy(true);
    setError(null);
    const rule = followUp ? data.followUpRules.find((r) => r.callResult === result) : undefined;
    const who = contact?.name ?? c.name;
    // A next call date the caller picked wins over the follow-up rule; "Not now" rests the company until then instead
    const followUpTask =
      nextIso && !notNow
        ? { title: `Call ${who} again`, taskType: "Call", dueAt: nextIso }
        : rule && !withFeedback?.revisitAt
          ? // Due on their working morning, so the follow-up comes up when they can be reached
            { title: rule.taskTitle, taskType: rule.taskType, dueAt: nextLocalMorning(c.timeZone, new Date(), rule.dueInDays) }
          : null;
    const res = await logActivity("COMPANY", c.id, {
      type: "CALL",
      callResult: result,
      gatekeeperType: /gatekeeper/i.test(result) ? gatekeeper || null : null,
      phoneNumberId: phone.startsWith("id:") ? phone.slice(3) : null,
      dialedNumber: phone.startsWith("raw:") ? phone.slice(4) : null,
      targetContactId: contactId || null,
      body: notes,
      occurredAt: new Date().toISOString(),
      feedbackRating: withFeedback?.rating ?? null,
      feedbackTags: withFeedback?.tags ?? [],
      revisitAt: withFeedback?.revisitAt ?? null,
      campaignId: data.campaign.id,
      followUp: followUpTask,
    });
    setBusy(false);
    if (!res.ok) return setError(res.error);
    const auto = res.data!.automations;
    const message = `${who}: ${result} submitted${withFeedback?.rating ? ` (${withFeedback.rating})` : ""}${withFeedback?.revisitAt ? `, back in the queue on ${formatDate(withFeedback.revisitAt)}` : followUpTask ? `, next call ${friendlyDateTime(followUpTask.dueAt)}` : ""}${auto.length ? `. ${auto.join(", ")}` : ""}`;
    // The note went with the call; drop the draft
    try {
      localStorage.removeItem(draftKey);
    } catch {}

    // Stay on this company (the caller moves on with Next company): get ready for the next person nobody has tried yet
    const nowTried = { ...tried, [contactId]: result };
    setTried(nowTried);
    setOutcome(null);
    setFeedback({ rating: null, tags: [], revisitAt: null });
    setNextAt("");
    setNotes("");
    setGatekeeper("");
    const next = callable.find((x) => !(x.id in nowTried));
    if (next) {
      setContactId(next.id);
      setPhone(numberFor(next.id));
    }
    onLogged(next ? `${message}. Next: ${next.name}` : `${message}. Everyone here has been tried`);
  }

  function pickTarget(id: string) {
    // Picking a person selects their own number; a company number is picked on its own (and clears the person)
    setContactId(id);
    setPhone(id ? numberFor(id) : companyFirst);
  }

  // Keyboard: 1–9/0 pick an outcome, Ctrl+Enter submits, ← back, → next company (not while typing)
  const outcomes = data.options.callResult;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (dialog) return;
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        void submit();
        return;
      }
      const el = e.target instanceof Element ? e.target : null;
      if (el?.closest("input, textarea, select, [contenteditable], [role=dialog]") || e.ctrlKey || e.metaKey || e.altKey) return;
      const i = KEYS.indexOf(e.key);
      if (i >= 0 && outcomes[i]) {
        e.preventDefault();
        setOutcome(outcomes[i].value);
      } else if (e.key === "ArrowRight") onSkip();
      else if (e.key === "ArrowLeft") onBack();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  // Company numbers vs people's direct lines. Callers learn which is which on the phone and move numbers between them.
  const lastTen = (n: string) => n.replace(/\D/g, "").slice(-10);
  const savedNumbers = new Set(c.phones.map((p) => lastTen(p.number)));
  const peopleIds = new Set(c.contacts.map((x) => x.id));
  const fromRow = (p: PhoneRow): Num => ({ key: p.id, value: `id:${p.id}`, source: { phoneId: p.id }, number: p.number, row: p });
  const directNumbers = (x: QueueCompany["contacts"][number]): Num[] => [
    ...c.phones.filter((p) => p.contactId === x.id).map(fromRow),
    ...(["phone", "mobile"] as const)
      .filter((k) => x[k] && !savedNumbers.has(lastTen(x[k]!)))
      .map((k) => ({ key: `${x.id}:${k}`, value: `raw:${x[k]}`, source: { contactId: x.id, field: k }, number: x[k]!, label: k === "mobile" ? "Mobile" : "Direct" })),
  ];
  // Lines of people who are no longer linked here stay with the company numbers, so nothing disappears
  const companyNumbers = c.phones.filter((p) => !p.contactId || !peopleIds.has(p.contactId)).map(fromRow);

  async function moveNumber(n: Num, to: string | null) {
    setError(null);
    const res = await moveCompanyNumber(c.id, n.source, to);
    if (!res.ok) return setError(res.error);
    if (phone === n.value) setPhone("");
    onChanged(`${formatPhone(n.number)} moved to ${to ? (c.contacts.find((x) => x.id === to)?.name ?? "the person") : "Company numbers"}`);
  }

  async function saveNumberNote(id: string) {
    setError(null);
    const res = await setPhoneNotes(c.id, id, noteText);
    if (!res.ok) return setError(res.error);
    setNoteFor(null);
    onChanged("Number note saved");
  }

  /** One number: dial it, see its status and notes, fix it, note it, or move it to the company or a person. */
  const renderNumber = (n: Num, owner: string | null, compact = false) => {
    const p = n.row;
    const dead = !!p && ["Wrong", "Disconnected"].includes(p.status);
    const selected = phone === n.value;
    const stop = (e: React.SyntheticEvent) => e.stopPropagation();
    return (
      <div
        key={n.key}
        className={cn(
          "flex items-start gap-2 rounded-[4px] border text-[13px]",
          compact ? "mt-1.5 bg-surface px-2 py-1.5" : "px-3 py-2",
          selected ? "border-link bg-[#f0f9fb]" : "border-line",
          dead && "opacity-60",
        )}
        onClick={(e) => e.preventDefault()}
      >
        <input
          type="radio"
          name="number"
          className="mt-1 accent-[var(--link)]"
          checked={selected}
          onChange={() => {
            setPhone(n.value);
            setContactId(owner ?? "");
          }}
          onClick={stop}
          aria-label={`Use ${formatPhone(n.number)}`}
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <a
              href={`tel:${n.number}${p?.extension ? `,${p.extension}` : ""}`}
              onClick={(e) => {
                e.stopPropagation();
                setContactId(owner ?? "");
                dial(n.value);
              }}
              className="font-medium text-link hover:underline"
            >
              <Phone className="mr-1 inline size-3" />
              {formatPhone(n.number)}
              {p?.extension ? ` ext. ${p.extension}` : ""}
            </a>
            <span className="text-[12px] text-ink-muted">{p?.type ?? n.label}</span>
            {p && <Pill label={p.status} color={PHONE_STATUS_COLORS[p.status]} />}
          </div>
          {p?.ivrPath && <div className="mt-0.5 font-mono text-[12px] text-ink">IVR: {p.ivrPath}</div>}
          {p && (
            <div className="text-[12px] text-ink-subtle">
              {p.contactId && !peopleIds.has(p.contactId) ? `${p.contactName ?? "Someone"}'s line (not linked here) · ` : ""}
              {p.lastDialedAt ? `last dialed ${friendlyDateTime(p.lastDialedAt)}` : "never dialed"}
            </div>
          )}
          {p?.notes && noteFor !== p.id && (
            <div className="mt-0.5 flex gap-1 rounded-[3px] bg-[#fdf3e1] px-1.5 py-0.5 text-[12px]">
              <NotebookPen className="mt-0.5 size-3 shrink-0 text-[#b07a1b]" />
              <span className="whitespace-pre-line">{p.notes}</span>
            </div>
          )}
          {p && noteFor === p.id && (
            <div className="mt-1 space-y-1" onClick={stop}>
              <textarea
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                rows={2}
                autoFocus
                placeholder="e.g. Ext 204 reaches the CTO; ask the receptionist for IT"
                aria-label="Number note"
                className="w-full rounded-[3px] border border-line-strong bg-surface px-2 py-1 text-[12px] focus:border-link focus:outline-none"
              />
              <div className="flex flex-wrap gap-1.5">
                {!owner && contact && !noteText.includes(contact.name) && (
                  <Button size="sm" variant="ghost" onClick={() => setNoteText((t) => `${t ? `${t.trimEnd()}\n` : ""}Reaches ${contact.name}${contact.jobTitle ? ` (${contact.jobTitle})` : ""}`)}>
                    <Plus /> Reaches {contact.name}
                  </Button>
                )}
                <Button size="sm" variant="primary" onClick={() => void saveNumberNote(p.id)}>
                  Save note
                </Button>
                <Button size="sm" variant="ghost" onClick={() => setNoteFor(null)}>
                  Cancel
                </Button>
              </div>
            </div>
          )}
          <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px]" onClick={stop}>
            {p && noteFor !== p.id && (
              <button type="button" className="text-link hover:underline" onClick={() => (setNoteFor(p.id), setNoteText(p.notes ?? ""))}>
                {p.notes ? "Edit note" : "Add note"}
              </button>
            )}
            {p && !p.extension && (
              <button type="button" className="text-link hover:underline" onClick={() => setDialog({ kind: "number", phone: p, extension: true })}>
                Add extension
              </button>
            )}
            {p && (
              <button type="button" className="text-link hover:underline" onClick={() => setDialog({ kind: "number", phone: p })}>
                Correct number
              </button>
            )}
            <select
              value=""
              onChange={(e) => e.target.value && void moveNumber(n, e.target.value === "company" ? null : e.target.value)}
              className="h-6 max-w-[170px] rounded-[3px] border border-line bg-surface px-1 text-[12px] text-link"
              aria-label={`Move ${formatPhone(n.number)}`}
            >
              <option value="">Move to…</option>
              {owner && <option value="company">Company numbers</option>}
              {[...listed, ...others]
                .filter((x) => x.id !== owner)
                .map((x) => (
                  <option key={x.id} value={x.id}>
                    {x.name}&apos;s direct line
                  </option>
                ))}
            </select>
          </div>
        </div>
      </div>
    );
  };

  const renderPerson = (x: QueueCompany["contacts"][number]) => (
    <label
      key={x.id}
      className={cn(
        "flex cursor-pointer items-start gap-2 rounded-[4px] border px-3 py-2 text-[13px]",
        contactId === x.id ? "border-link bg-[#f0f9fb]" : "border-line hover:bg-surface-hover",
        x.doNotCall && "cursor-not-allowed opacity-60",
      )}
    >
      <input
        type="radio"
        name="target"
        className="mt-1 accent-[var(--link)]"
        disabled={x.doNotCall}
        checked={contactId === x.id}
        onChange={() => pickTarget(x.id)}
      />
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-1.5">
          <Link href={`/contacts/${x.id}`} target="_blank" className="font-medium hover:underline">
            {x.name}
          </Link>
          {x.labels.map((l) => (
            <Pill key={l} label={l} />
          ))}
          {x.inDbnd?.toLowerCase() === "yes" && <Pill label="In DBND" color="#00a4bd" />}
          {x.doNotCall && <Pill label="Do not call" color="#f2545b" />}
          {x.id in tried && <Pill label={`Tried: ${tried[x.id]}`} color="#00bda5" />}
          {x.target && (
            <Pill
              label={x.target.done ? `Done: ${x.target.status}` : `${x.target.attempts}${data.campaign.maxAttempts ? ` of ${data.campaign.maxAttempts}` : ""} calls`}
              color={x.target.done ? "#99afc4" : "#6a78d1"}
            />
          )}
        </span>
        <span className="block text-[12px] text-ink-muted">{[x.jobTitle, x.email].filter(Boolean).join(" · ")}</span>
        <span className="block text-[12px] text-ink-subtle">
          CRT {x.crtCount} · {x.callStatus ?? "Never called"}
          {x.leadStatus ? ` · ${x.leadStatus}` : ""}
        </span>
        {directNumbers(x).map((n) => renderNumber(n, x.id, true))}
        <span className="mt-1 flex gap-3 text-[12px]">
          <button type="button" className="text-link hover:underline" onClick={(e) => (e.preventDefault(), setDialog({ kind: "contact", contact: x }))}>
            Correct info
          </button>
          <button type="button" className="text-link hover:underline" onClick={(e) => (e.preventDefault(), setDialog({ kind: "research", contactId: x.id }))}>
            Ask research
          </button>
        </span>
      </span>
    </label>
  );

  return (
    <>
      {dialog?.kind === "company" && <EditCompanyDialog company={c} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog?.kind === "contact" && <ContactDialog companyId={c.id} contact={dialog.contact} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog?.kind === "number" && <NumberDialog data={data} company={c} phone={dialog.phone} focusExtension={dialog.extension} onClose={() => setDialog(null)} onDone={changed} />}
      {dialog?.kind === "research" && (
        <ResearchRequestDialog
          data={data}
          company={c}
          contactId={dialog.contactId}
          onClose={() => setDialog(null)}
          onDone={(message, held) => {
            setDialog(null);
            // A held company leaves the queue for now, so move on to the next one
            if (held) onSnoozed(message);
            else onChanged(message);
          }}
        />
      )}
      {/* Company, targets, numbers, past attempts */}
      <div className="thin-scroll min-h-0 space-y-4 overflow-y-auto px-5 py-4">
        <header className="flex flex-wrap items-start gap-3">
          <CompanyLogo name={c.name} domain={c.domain} size={44} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[20px] font-medium">{c.name}</h1>
              <Link href={`/companies/${c.id}`} target="_blank" className="text-link hover:underline" aria-label="Open the company record in a new tab">
                <ExternalLink className="size-4" />
              </Link>
            </div>
            <div className="text-[13px] text-ink-muted">
              {[c.domain, c.industry, c.employees ? `${c.employees.toLocaleString()} employees` : null, [c.city, c.state, c.country].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}
            </div>
            <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[12px]">
              {c.leadState && <Pill label={c.leadState} color={journey?.color} />}
              {c.member && <Pill label={c.member.status} />}
              <FollowBadge group={c.followGroup} score={c.followScore} />
              <span className={cn("text-ink-muted", maxed && "font-medium text-danger")}>
                {c.member?.attempts ?? 0}
                {data.campaign.maxAttempts ? ` of ${data.campaign.maxAttempts}` : ""} attempts in this campaign
                {c.member?.connects ? ` · ${c.member.connects} connected` : ""}
              </span>
              {c.member?.nextActionAt && <span className="text-ink-muted">· next action {friendlyDateTime(c.member.nextActionAt)}</span>}
            </div>
            {c.followReason && <div className="mt-1 text-[12px] text-ink-muted">Caller feedback: {c.followReason}</div>}
            <div className="mt-2 flex flex-wrap gap-1.5">
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "company" })}>
                <Pencil /> Correct company info
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setDialog({ kind: "research" })}>
                <FlaskConical /> Ask research
              </Button>
            </div>
          </div>
          <div className={cn("rounded-[6px] border px-3 py-2 text-right", hours === false ? "border-line bg-surface-muted" : "border-[#00bda5] bg-[#e5f8f6]")}>
            <div className="text-[20px] font-medium tabular-nums">{c.timeZone ? <LocalTime tz={c.timeZone} /> : "--:--"}</div>
            <div className="text-[11px] text-ink-muted">{c.timeZone ? `${hours === false ? "Outside business hours" : "Business hours"} · ${c.timeZone.split("/").pop()?.replace("_", " ")}` : "Time zone unknown"}</div>
          </div>
        </header>

        {maxed && (
          <p className="rounded-[4px] bg-[#fdf3e1] px-3 py-2 text-[13px]">
            {forPeople
              ? "Everyone on the list at this company is done (final outcome or out of attempts). Move on to the next company."
              : `This company has reached the campaign's ${data.campaign.maxAttempts} attempts. Consider Nurture or Not interested on the campaign page.`}
          </p>
        )}

        {(c.signals.length > 0 || c.pitchNotes || c.tasks.length > 0) && (
          <section className="grid gap-3 md:grid-cols-2">
            {(c.signals.length > 0 || c.pitchNotes) && (
              <div className="rounded-[4px] border border-line p-3 text-[13px]">
                <h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Why call now</h2>
                <ul className="space-y-1">
                  {c.signals.map((s) => (
                    <li key={s.id}>
                      <Pill label={s.type} color="#6a78d1" /> <span>{s.title}</span> <span className="text-[12px] text-ink-subtle">{formatDate(s.detectedAt)}</span>
                    </li>
                  ))}
                </ul>
                {c.pitchNotes && <p className="mt-1.5 whitespace-pre-line text-ink-muted">{c.pitchNotes}</p>}
              </div>
            )}
            {c.tasks.length > 0 && (
              <div className="rounded-[4px] border border-line p-3 text-[13px]">
                <h2 className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">Open tasks</h2>
                <ul className="space-y-1">
                  {c.tasks.map((t) => (
                    <li key={t.id} className="flex gap-2">
                      <span className="min-w-0 flex-1 truncate">{t.title}</span>
                      <span className={cn("shrink-0 text-[12px]", t.dueAt && new Date(t.dueAt) < new Date() ? "text-danger" : "text-ink-subtle")}>{t.dueAt ? friendlyDateTime(t.dueAt) : ""}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </section>
        )}

        <ResearchPanel company={c} onAsk={() => setDialog({ kind: "research" })} onChanged={changed} />


        <section className="grid gap-4 2xl:grid-cols-2">
          <div>
            <div className="mb-2 flex items-center">
              <h2 className="flex-1 text-[14px] font-semibold">{forPeople ? `Campaign targets (${listed.length})` : `Targets (${c.contacts.length})`}</h2>
              <Button size="sm" variant="ghost" className="text-link" onClick={() => setDialog({ kind: "contact", contact: null })}>
                <Plus /> Add person
              </Button>
            </div>
            <div className="space-y-1.5">
              {listed.map(renderPerson)}
              {!listed.length && (
                <p className="text-[13px] text-ink-subtle">{forPeople ? "Nobody at this company is on the campaign's list." : "No targets yet. Calls are logged against the company line."}</p>
              )}
              {c.movedTargets > 0 && (
                <p className="text-[12px] text-ink-subtle">
                  {c.movedTargets} targeted {c.movedTargets === 1 ? "person is" : "people are"} no longer linked to this company. Remove them on the campaign&apos;s People tab.
                </p>
              )}
              {others.length > 0 && (
                <details className="rounded-[4px] border border-dashed border-line px-3 py-2 text-[13px]">
                  <summary className="cursor-pointer text-ink-muted">
                    Other people at this company ({others.length}): not on this campaign&apos;s list
                  </summary>
                  <div className="mt-2 space-y-1.5">{others.map(renderPerson)}</div>
                </details>
              )}
              {!c.contacts.length && <p className="text-[13px] text-ink-subtle">No targets yet. Calls are logged against the company line.</p>}
            </div>
          </div>

          <div>
            <div className="mb-2 flex items-center">
              <h2 className="flex-1 text-[14px] font-semibold">Company Numbers ({companyNumbers.length})</h2>
              <Button size="sm" variant="ghost" className="text-link" onClick={() => setDialog({ kind: "number", phone: null })}>
                <Plus /> Add number
              </Button>
            </div>
            <p className="mb-1.5 text-[12px] text-ink-subtle">The company&apos;s own lines. People&apos;s direct numbers are under their names; use Move to fix either.</p>
            <div className="space-y-1.5">
              {companyNumbers.map((n) => renderNumber(n, null))}
              {c.phone && !savedNumbers.has(lastTen(c.phone)) && (
                <a href={`tel:${c.phone}`} onClick={() => dial(`raw:${c.phone}`)} className="block rounded-[4px] border border-line px-3 py-2 text-[13px] text-link hover:underline">
                  {formatPhone(c.phone)} <span className="text-ink-subtle">(company phone)</span>
                </a>
              )}
              {!companyNumbers.length && !(c.phone && !savedNumbers.has(lastTen(c.phone))) && (
                <p className="text-[13px] text-ink-subtle">No company numbers yet. Add one, or ask research to find them.</p>
              )}
            </div>
          </div>
        </section>

        <section>
          <h2 className="mb-2 text-[14px] font-semibold">
            Past attempts ({c.calls.length}){c.notes.length > 0 && <span className="font-normal text-ink-muted"> · {c.notes.length} note{c.notes.length === 1 ? "" : "s"}</span>}
          </h2>
          <ol className="space-y-2 border-l-2 border-line pl-3">
            {/* Calls and standalone notes in one timeline, newest first */}
            {[...c.calls.map((call) => ({ at: call.at, call, note: null })), ...c.notes.map((note) => ({ at: note.at, call: null, note }))]
              .sort((x, y) => y.at.localeCompare(x.at))
              .map(({ call, note: a }) =>
                a ? (
                  <li key={a.id} className="relative text-[13px]">
                    <span className="absolute -left-[17px] top-1.5 size-2 rounded-full bg-[#f5c26b]" />
                    <div className="flex flex-wrap items-center gap-x-2">
                      <NotebookPen className="size-3.5 text-[#b07a1b]" />
                      <span className="font-medium">Note</span>
                    </div>
                    <div className="text-[12px] text-ink-subtle">
                      {friendlyDateTime(a.at)}
                      {a.by ? ` · ${a.by}` : ""}
                    </div>
                    {a.body && <p className="whitespace-pre-line text-ink">{a.body.replace(/<[^>]+>/g, "")}</p>}
                  </li>
                ) : (
                  <CallItem key={call!.id} a={call!} />
                ),
              )}
            {!c.calls.length && <li className="text-[13px] text-ink-subtle">First call to this company.</li>}
          </ol>
        </section>
      </div>

      {/* Logger: who and which number, then Outcome → Caller notes → Next call date → Submit */}
      <aside className="thin-scroll min-h-0 space-y-3 overflow-y-auto border-t border-line bg-surface-muted px-4 py-4 lg:border-l lg:border-t-0">
        {data.campaign.pitch && (
          <details open className="rounded-[4px] border border-line bg-surface px-3 py-2 text-[13px]">
            <summary className="cursor-pointer font-semibold">Campaign pitch</summary>
            <p className="thin-scroll mt-1 max-h-[160px] overflow-y-auto whitespace-pre-line text-ink-muted">{data.campaign.pitch}</p>
          </details>
        )}

        <div className="space-y-3 rounded-[6px] border border-line bg-surface p-3" role="group" aria-label="Call feedback">
          {/* 1. Outcome */}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">1. Outcome</div>
            <div className="grid grid-cols-2 gap-1.5">
              {outcomes.map((o, i) => (
                <button
                  key={o.value}
                  type="button"
                  disabled={busy}
                  onClick={() => setOutcome((x) => (x === o.value ? null : o.value))}
                  aria-pressed={outcome === o.value}
                  className={cn(
                    "flex min-h-9 items-center gap-1.5 rounded-[3px] border px-2 py-1.5 text-left text-[12.5px] font-medium disabled:opacity-50",
                    outcomeTone(o.value),
                    outcome === o.value && "ring-2 ring-link ring-offset-1",
                    outcome && outcome !== o.value && "opacity-60",
                  )}
                >
                  {KEYS[i] && <kbd className="rounded border border-current/30 px-1 font-mono text-[10px] opacity-70">{KEYS[i]}</kbd>}
                  <span className="min-w-0 flex-1">{o.label}</span>
                </button>
              ))}
            </div>
            {outcome && /gatekeeper/i.test(outcome) && (
              <Select className="mt-1.5" value={gatekeeper} onChange={(e) => setGatekeeper(e.target.value)} aria-label="Gatekeeper type">
                <option value="">Gatekeeper type --</option>
                {data.options.gatekeeperType.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            )}
            {conversation && <FeedbackFields who={contact?.name ?? c.name} value={feedback} onChange={setFeedback} />}
          </div>

          {/* 2. Caller notes */}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">2. Caller notes</div>
            <textarea
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              rows={3}
              placeholder="Who answered, what they said, next steps"
              aria-label="Caller notes"
              className="w-full rounded-[3px] border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-link focus:outline-none"
            />
            <div className="flex items-start gap-2">
              <p className="flex-1 text-[11px] text-ink-subtle">Saved with the call. Your draft is kept if you leave this company.</p>
              <Button size="sm" variant="ghost" disabled={!notes.trim() || busy} onClick={() => void saveNote()}>
                Save note only
              </Button>
            </div>
          </div>

          {/* 3. Next call date */}
          <div>
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-subtle">3. Next call date {notNow ? "(required for Not now)" : "(optional)"}</div>
            <div className="mb-1.5 flex flex-wrap gap-1.5">
              {[
                ["Tomorrow", 1],
                ["In 2 days", 2],
                ["Next week", 5],
                ["In a month", 22],
              ].map(([label, days]) => {
                const v = toLocalInput(nextLocalMorning(c.timeZone, new Date(), days as number));
                return (
                  <Button key={label} size="sm" variant={nextAt === v ? "primary" : "secondary"} onClick={() => setNextAt(nextAt === v ? "" : v)}>
                    {label}
                  </Button>
                );
              })}
            </div>
            <Input type="datetime-local" value={nextAt} onChange={(e) => setNextAt(e.target.value)} aria-label="Next call date (Dhaka time)" className="h-8" />
            <p className={cn("mt-1 text-[11px]", pastNext || (notNow && !nextIso) ? "text-danger" : "text-ink-subtle")}>
              {pastNext
                ? "Pick a time in the future."
                : notNow
                  ? nextIso
                    ? `The company rests and comes back to the queue on ${whenBoth(nextIso)}.`
                    : "Pick when to ask again."
                  : nextIso
                    ? `Creates a call task for ${contact?.name ?? c.name} and brings the company back to the queue on ${whenBoth(nextIso)}.`
                    : "Quick picks are their next working morning. Leave empty to use the follow-up rules."}
            </p>
          </div>

          {error && <p className="rounded-[3px] bg-danger-soft px-3 py-2 text-[13px] text-danger">{error}</p>}

          <Button variant="primary" className="w-full justify-center" disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Submitting…" : outcome ? `Submit for ${contact?.name ?? "the company line"}: ${outcome}` : "Submit (pick an outcome first)"}
          </Button>
          <label className="flex cursor-pointer items-center gap-2 text-[12px] text-ink-muted">
            <input type="checkbox" className="accent-[var(--link)]" checked={followUp} onChange={(e) => setFollowUp(e.target.checked)} />
            Without a next call date, create follow-up tasks from the follow-up rules
          </label>
        </div>

        {/* Progress through this company's people; the caller moves on only with Next company */}
        <div className={cn("rounded-[4px] border px-3 py-2.5 text-[13px]", Object.keys(tried).length && !untried.length ? "border-[#00bda5] bg-[#e5f8f6]" : "border-line bg-surface")}>
          <div className="mb-1.5">
            {callable.length ? (
              <>
                Tried <strong>{callable.length - untried.length}</strong> of {callable.length} people at {c.name}
                {untried.length ? ` · still to try: ${untried.map((x) => x.name).join(", ")}` : ". Everyone has been tried."}
              </>
            ) : (
              <>{forPeople ? "Everyone on the list here is done." : `Company line ${"" in tried ? `tried: ${tried[""]}` : "not tried yet"}`}</>
            )}
          </div>
          <Button size="sm" variant={Object.keys(tried).length && !untried.length ? "primary" : "secondary"} className="w-full justify-center" disabled={!hasNext} onClick={onSkip}>
            Next company <ArrowRight />
          </Button>
        </div>

        <p className="text-[11px] text-ink-subtle">
          Keys: 1–9, 0 pick an outcome · Ctrl+Enter submits · → next company · ← previous.
        </p>
      </aside>
    </>
  );
}

/** One logged call in the Past attempts timeline, with its note. */
function CallItem({ a }: { a: QueueCompany["calls"][number] }) {
  return (
    <li className="relative text-[13px]">
      <span className={cn("absolute -left-[17px] top-1.5 size-2 rounded-full", /^connected|meeting/i.test(a.result ?? "") ? "bg-[#00bda5]" : "bg-[#cbd6e2]")} />
      <div className="flex flex-wrap items-center gap-x-2">
        <span className="font-medium">{a.result ?? "Call"}</span>
        {a.path && <span className="text-[12px] text-ink-muted">via {a.path}</span>}
        {a.gatekeeperType && <span className="text-[12px] text-ink-muted">({a.gatekeeperType})</span>}
        {a.campaign && <Pill label={a.thisCampaign ? "This campaign" : a.campaign.name} color={a.thisCampaign ? "#00a4bd" : undefined} />}
        {a.feedbackRating && <Pill label={a.feedbackRating} color={FEEDBACK_RATINGS.find((r) => r.value === a.feedbackRating)?.color} />}
      </div>
      {(a.feedbackTags.length > 0 || a.revisitAt) && (
        <div className="text-[12px] text-ink-muted">
          {a.feedbackTags.map((t) => FEEDBACK_TAGS.find((x) => x.key === t)?.short ?? t).join(" · ")}
          {a.revisitAt ? `${a.feedbackTags.length ? " · " : ""}ask again ${formatDate(a.revisitAt)}` : ""}
        </div>
      )}
      <div className="text-[12px] text-ink-subtle">
        {friendlyDateTime(a.at)}
        {a.contact ? ` · ${a.contact}` : ""}
        {a.number ? ` · ${formatPhone(a.number)}` : ""}
        {a.durationSec ? ` · ${duration(a.durationSec)}` : ""}
        {a.by ? ` · ${a.by}` : ""}
      </div>
      {a.body && <p className="whitespace-pre-line text-ink">{a.body.replace(/<[^>]+>/g, "")}</p>}
    </li>
  );
}

type PhoneRow = QueueCompany["phones"][number];
/** A number shown on the page: a saved number, or one typed on a contact record */
type Num = { key: string; value: string; source: NumberSource; number: string; row?: PhoneRow; label?: string };

type Feedback = { rating: string | null; tags: string[]; revisitAt: string | null };

/** Quick feedback after a real conversation: how promising, and what we learned. "Not now" uses the next call date as the revisit date. */
function FeedbackFields({ who, value, onChange }: { who: string; value: Feedback; onChange: (v: Feedback) => void }) {
  const toggle = (k: string) => onChange({ ...value, tags: value.tags.includes(k) ? value.tags.filter((x) => x !== k) : [...value.tags, k] });
  return (
    <div className="mt-2 space-y-2 rounded-[4px] bg-surface-muted p-2.5 text-[13px]">
      <div className="text-[12px] text-ink-muted">How promising is {who}? This decides who to chase and who to nurture.</div>
      <div className="grid grid-cols-3 gap-1.5">
        {FEEDBACK_RATINGS.map((r) => (
          <Tooltip key={r.value} content={r.help}>
            <button
              type="button"
              onClick={() => onChange({ ...value, rating: value.rating === r.value ? null : r.value })}
              aria-pressed={value.rating === r.value}
              className={cn("rounded-[4px] border-2 py-1 font-semibold", value.rating === r.value ? "text-white" : "bg-surface hover:bg-surface-hover")}
              style={{ borderColor: r.color, ...(value.rating === r.value ? { background: r.color } : { color: r.color }) }}
            >
              {r.value}
            </button>
          </Tooltip>
        ))}
      </div>
      <div className="grid grid-cols-1 gap-1">
        {FEEDBACK_TAGS.map((t) => (
          <label key={t.key} className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="accent-[var(--link)]" checked={value.tags.includes(t.key)} onChange={() => toggle(t.key)} />
            {t.label}
          </label>
        ))}
      </div>
    </div>
  );
}

/** Follow-up group and score, e.g. "Chase now · 72". */
export function FollowBadge({ group, score }: { group: string | null; score: number }) {
  if (!group) return null;
  const info = FOLLOW_GROUP_INFO[group as FollowGroup];
  return (
    <Tooltip content={info?.help ?? group}>
      <span className="inline-flex items-center gap-1 rounded-full px-2 py-[1px] text-[12px] font-semibold text-white" style={{ background: info?.color ?? "#99afc4" }}>
        {group} · {score}
      </span>
    </Tooltip>
  );
}
