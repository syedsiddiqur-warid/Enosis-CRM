"use client";

import { ArrowDownLeft, ArrowUpRight, CalendarPlus, Plus, Sparkles } from "lucide-react";
import { PropValue } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import { formatDate, friendlyDateTime } from "@/lib/crm/dates";
import type { RecordActivity } from "@/lib/crm/record-types";
import { cn } from "@/lib/utils";
import { useRecord } from "./record-context";
import { ActivityIcon } from "./record-ui";
import { activityTime, activityTitle, isOpenTask, isOverdue } from "./timeline";

const DAY = 864e5;

function Section({ title, actions, children }: { title: string; actions?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="rounded-[4px] border border-line bg-surface">
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h3 className="flex-1 text-[14px] font-semibold">{title}</h3>
        {actions}
      </div>
      <div className="px-4 py-3">{children}</div>
    </section>
  );
}

function plural(n: number, word: string) {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

/** Overview tab without AI: highlights, recent interactions, what's next, call stats and the latest activity. */
export function Overview() {
  const { data, openComposer, setTab } = useRecord();
  const now = Date.now();
  const userName = (id: string | null) => (id ? (data.users.find((u) => u.id === id)?.name ?? "Unknown user") : "System");
  const real = data.activities.filter((a) => a.type !== "SYSTEM");
  const recent = real.filter((a) => !isOpenTask(a) && new Date(activityTime(a)).getTime() >= now - 30 * DAY && new Date(activityTime(a)).getTime() <= now);
  const calls = data.activities.filter((a) => a.type === "CALL");
  const emails = recent.filter((a) => a.type === "EMAIL").length;
  const meetings = recent.filter((a) => a.type === "MEETING").length;
  const recentCalls = recent.filter((a) => a.type === "CALL").length;

  const inbound = real.filter((a) => a.type === "EMAIL" && a.emailDirection === "INBOUND").slice(0, 4);
  const outbound = real
    .filter((a) => isOverdue(a, now) || a.type === "CALL" || (a.type === "EMAIL" && a.emailDirection !== "INBOUND") || (a.type === "MEETING" && new Date(activityTime(a)).getTime() <= now))
    .sort((x, y) => Number(isOverdue(y, now)) - Number(isOverdue(x, now)))
    .slice(0, 4);

  const openTasks = real.filter(isOpenTask).sort((x, y) => new Date(x.dueAt ?? 0).getTime() - new Date(y.dueAt ?? 0).getTime());
  const nextMeeting = real
    .filter((a) => a.type === "MEETING" && new Date(activityTime(a)).getTime() > now)
    .sort((x, y) => new Date(activityTime(x)).getTime() - new Date(activityTime(y)).getTime())[0];

  const connected = calls.filter((c) => /^connected/i.test(c.callResult ?? "")).length;
  // Imported CRT counts can exceed logged calls, so contacts use the rollup
  const crt = data.object === "CONTACT" ? Number(data.values.crtCount ?? calls.length) : calls.length;
  const outcomes = Object.entries(
    calls.reduce<Record<string, number>>((m, c) => {
      const k = c.callResult ?? "Unknown";
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {}),
  ).sort((a, b) => b[1] - a[1]);
  const lastCall = calls[0];

  const highlights = ["createdAt", "lifecycleStage", "leadStatus", "lastActivityAt"]
    .map((p) => data.defs.find((d) => d.name === p))
    .filter((d) => !!d);

  const summary = recent.length
    ? `In the last 30 days: ${[recentCalls && plural(recentCalls, "call"), emails && plural(emails, "email"), meetings && plural(meetings, "meeting"), recent.filter((a) => a.type === "NOTE").length && plural(recent.filter((a) => a.type === "NOTE").length, "note")].filter(Boolean).join(", ")}.`
    : "No calls, emails or meetings in the last 30 days.";
  const lastContacted = data.values.lastContactedAt ? ` Last contacted ${formatDate(String(data.values.lastContactedAt))}.` : "";

  return (
    <div className="space-y-4">
      {!data.aiEnabled && (
        <div className="flex items-start gap-2 rounded-[4px] border border-dashed border-line-strong bg-surface-muted px-4 py-2.5 text-[12px] text-ink-muted">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          AI insights (summary, sentiment, suggested actions) are off. This tab shows the standard summary; the AI Catch-up arrives in build step 12.
        </div>
      )}

      <Section title="Data highlights">
        <div className="grid grid-cols-2 gap-4 @xl:grid-cols-4">
          {highlights.map((d) => (
            <div key={d!.name} className="min-w-0">
              <div className="text-[11px] uppercase tracking-wide text-ink-subtle">{d!.label}</div>
              <div className="mt-1 text-[13px]">
                <PropValue def={d!} value={data.values[d!.name]} users={data.users} />
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section
        title="Recent interactions"
        actions={
          <Button size="sm" variant="secondary" onClick={() => openComposer("meeting")}>
            <CalendarPlus /> Schedule a meeting
          </Button>
        }
      >
        <p className="mb-3 text-[13px]">
          {summary}
          {lastContacted}
        </p>
        <div className="grid gap-3 @lg:grid-cols-2">
          <InteractionBox title="Inbound" icon={<ArrowDownLeft className="size-4 text-[#00bda5]" />} items={inbound} empty="No inbound emails logged" userName={userName} />
          <InteractionBox title="Outbound" icon={<ArrowUpRight className="size-4 text-[#ff7a59]" />} items={outbound} empty="No outreach logged yet" userName={userName} />
        </div>
      </Section>

      <div className="grid gap-4 @2xl:grid-cols-2">
        <Section
          title="What's next"
          actions={
            <Button size="sm" variant="ghost" className="text-link" onClick={() => openComposer("task")}>
              <Plus /> Task
            </Button>
          }
        >
          <div className="space-y-2 text-[13px]">
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Next task</div>
              {openTasks[0] ? (
                <button className="text-left text-link hover:underline" onClick={() => setTab("activities")}>
                  {openTasks[0].title}
                  <span className={cn("ml-1 text-[12px]", isOverdue(openTasks[0], now) ? "text-danger" : "text-ink-muted")}>
                    {isOverdue(openTasks[0], now) ? "overdue, " : ""}due {friendlyDateTime(openTasks[0].dueAt)}
                  </span>
                </button>
              ) : (
                <div className="text-ink-subtle">No open tasks</div>
              )}
              {openTasks.length > 1 && <div className="text-[12px] text-ink-subtle">+{openTasks.length - 1} more open</div>}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Next meeting</div>
              {nextMeeting ? (
                <div>
                  {nextMeeting.title} <span className="text-[12px] text-ink-muted">{friendlyDateTime(activityTime(nextMeeting))}</span>
                </div>
              ) : (
                <div className="text-ink-subtle">None scheduled</div>
              )}
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-ink-subtle">Next follow-up</div>
              <div>{data.values.nextFollowUpAt ? formatDate(String(data.values.nextFollowUpAt)) : <span className="text-ink-subtle">Not set</span>}</div>
            </div>
          </div>
        </Section>

        <Section
          title="Call stats"
          actions={
            <Button size="sm" variant="ghost" className="text-link" onClick={() => openComposer("call")}>
              <Plus /> Log call
            </Button>
          }
        >
          <div className="mb-3 grid grid-cols-3 gap-2 text-center">
            {[
              ["CRT count", crt],
              ["Connected", connected],
              ["Connect rate", calls.length ? `${Math.round((connected / calls.length) * 100)}%` : "--"],
            ].map(([l, v]) => (
              <div key={String(l)} className="rounded-[4px] bg-surface-muted py-2">
                <div className="text-[18px] font-medium tabular-nums">{v}</div>
                <div className="text-[11px] text-ink-muted">{l}</div>
              </div>
            ))}
          </div>
          {lastCall && (
            <p className="mb-2 text-[12px] text-ink-muted">
              Last call {friendlyDateTime(lastCall.occurredAt)}: {lastCall.callResult}
            </p>
          )}
          {outcomes.map(([k, n]) => (
            <div key={k} className="mb-1 flex items-center gap-2 text-[12px]">
              <span className="w-[150px] shrink-0 truncate">{k}</span>
              <span className="h-2 rounded-full bg-[#00bda5]" style={{ width: `${(n / calls.length) * 100}%`, minWidth: 6 }} />
              <span className="tabular-nums text-ink-muted">{n}</span>
            </div>
          ))}
          {!calls.length && <p className="text-[13px] text-ink-subtle">No calls logged{crt ? ` (CRT count ${crt} came from the import)` : ""}.</p>}
        </Section>
      </div>

      <Section
        title="Recent activity"
        actions={
          <Button size="sm" variant="ghost" className="text-link" onClick={() => setTab("activities")}>
            View all activities
          </Button>
        }
      >
        <ol className="space-y-2.5">
          {data.activities.slice(0, 5).map((a) => (
            <li key={a.id} className="flex items-start gap-2.5 text-[13px]">
              <ActivityIcon type={a.type} size={22} />
              <div className="min-w-0">
                <div className="truncate">{activityTitle(a, userName)}</div>
                <div className="text-[12px] text-ink-subtle">{friendlyDateTime(activityTime(a))}</div>
              </div>
            </li>
          ))}
          {!data.activities.length && <li className="text-ink-subtle">Nothing yet</li>}
        </ol>
      </Section>
    </div>
  );
}

function InteractionBox({ title, icon, items, empty, userName }: { title: string; icon: React.ReactNode; items: RecordActivity[]; empty: string; userName: (id: string | null) => string }) {
  const now = Date.now();
  return (
    <div className="rounded-[4px] border border-line bg-surface-muted px-3 py-2.5">
      <div className="mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-wide text-ink-muted">
        {icon} {title}
      </div>
      <ul className="space-y-1.5 text-[13px]">
        {items.map((a) => (
          <li key={a.id} className="flex items-baseline justify-between gap-2">
            <span className="truncate">{a.type === "TASK" ? `Task – ${isOverdue(a, now) ? "Overdue" : "Open"}: ${a.title}` : activityTitle(a, userName)}</span>
            <span className={cn("shrink-0 text-[12px]", isOverdue(a, now) ? "text-danger" : "text-ink-subtle")}>{formatDate(activityTime(a))}</span>
          </li>
        ))}
        {!items.length && <li className="text-ink-subtle">{empty}</li>}
      </ul>
    </div>
  );
}
