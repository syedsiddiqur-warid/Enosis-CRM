"use client";

import {
  Building2,
  CalendarDays,
  Check,
  ExternalLink,
  Megaphone,
  Play,
  UserRound,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { CompanyLogo, LocalTime, Pill } from "@/components/index/values";
import { Button } from "@/components/ui/button";
import { friendlyDateTime } from "@/lib/crm/dates";
import type { HomeData } from "@/lib/crm/home-loader";
import { setTasksDone } from "@/lib/crm/task-actions";
import { cn } from "@/lib/utils";

const TZ = "Asia/Dhaka";
const time = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("en-US", {
        timeZone: TZ,
        hour: "numeric",
        minute: "2-digit",
      }).format(new Date(iso))
    : "";
const weekday = (key: string) =>
  new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
  }).format(new Date(`${key}T12:00:00Z`));

function greeting() {
  const h = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: TZ,
      hour: "numeric",
      hourCycle: "h23",
    }).format(new Date()),
  );
  return h < 12 ? "Good morning" : h < 17 ? "Good afternoon" : "Good evening";
}

function Card({
  title,
  count,
  actions,
  children,
  className,
}: {
  title: string;
  count?: number;
  actions?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn("rounded-[6px] border border-line bg-surface", className)}
    >
      <div className="flex items-center gap-2 border-b border-line px-4 py-2.5">
        <h2 className="flex-1 text-[14px] font-semibold">
          {title}
          {count !== undefined && (
            <span className="ml-1 font-normal text-ink-subtle">({count})</span>
          )}
        </h2>
        {actions}
      </div>
      {children}
    </section>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="px-4 py-5 text-[13px] text-ink-subtle">{children}</p>;
}

export function Home({ data }: { data: HomeData }) {
  const router = useRouter();
  const [, start] = useTransition();
  const [toast, setToast] = useState<{
    message: string;
    undo?: () => Promise<unknown>;
  } | null>(null);
  const [hello, setHello] = useState("Hello");
  const s = data.stats;
  const startToday = new Date(data.startToday).getTime();
  const endToday = new Date(data.endToday).getTime();

  // Greeting depends on the clock, so set it after hydration
  useEffect(() => setHello(greeting()), []);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 6000);
    return () => clearTimeout(t);
  }, [toast]);

  const complete = (id: string, title: string) =>
    start(async () => {
      const res = await setTasksDone([id], true);
      if (!res.ok) return setToast({ message: res.error });
      setToast({
        message: `Completed “${title}”`,
        undo: () => setTasksDone([id], false),
      });
      router.refresh();
    });

  const followGroups = [
    [
      "Overdue",
      data.followUps.filter((f) => new Date(f.at).getTime() < startToday),
    ],
    [
      "Today",
      data.followUps.filter(
        (f) =>
          new Date(f.at).getTime() >= startToday &&
          new Date(f.at).getTime() <= endToday,
      ),
    ],
    [
      "Next 7 days",
      data.followUps.filter((f) => new Date(f.at).getTime() > endToday),
    ],
  ] as const;
  const maxDay = Math.max(1, ...s.perDay.map((d) => d.calls));
  const rate = s.week.calls
    ? Math.round((s.week.connects / s.week.calls) * 100)
    : null;
  const dateLabel = new Intl.DateTimeFormat("en-US", {
    timeZone: TZ,
    weekday: "long",
    month: "long",
    day: "numeric",
  }).format(new Date());

  return (
    <div className="thin-scroll h-full overflow-y-auto">
      <div className="mx-auto max-w-[1280px] space-y-3">
        <section className="flex flex-wrap items-center gap-3 rounded-[6px] border border-line bg-surface px-6 py-4">
          <div className="min-w-0 flex-1">
            <h1 className="text-[20px] font-medium">
              {hello}, {data.firstName}
            </h1>
            <p className="text-[13px] text-ink-muted">
              {dateLabel} ·{" "}
              {data.taskCounts.today + data.taskCounts.overdue
                ? `${data.taskCounts.today} task${data.taskCounts.today === 1 ? "" : "s"} due today${data.taskCounts.overdue ? `, ${data.taskCounts.overdue} overdue` : ""}`
                : "no tasks due"}
              {data.meetings.length
                ? ` · ${data.meetings.length} meeting${data.meetings.length === 1 ? "" : "s"} today`
                : ""}
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {data.taskCounts.overdue > 0 && (
              <Button variant="secondary" asChild>
                <Link href="/tasks/start?tab=overdue">
                  Start {data.taskCounts.overdue} overdue
                </Link>
              </Button>
            )}
            <Button
              variant="primary"
              asChild
              aria-disabled={!data.taskCounts.today}
            >
              <Link
                href="/tasks/start?tab=today"
                className={cn(
                  !data.taskCounts.today && "pointer-events-none opacity-50",
                )}
              >
                <Play /> Start {data.taskCounts.today} due today
              </Link>
            </Button>
            <Button variant="secondary" asChild>
              <Link href="/prospecting">
                <Megaphone /> Calling queue
              </Link>
            </Button>
          </div>
        </section>

        <section
          className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6"
          aria-label="My call stats"
        >
          {(
            [
              ["Calls today", s.today.calls, null],
              ["Connects today", s.today.connects, null],
              [
                "Connect rate, 7 days",
                rate === null ? "--" : `${rate}%`,
                `${s.week.connects} of ${s.week.calls} calls`,
              ],
              ["Meetings booked, 7 days", s.meetingsBooked, null],
              [
                "Talk time today",
                `${Math.floor(s.talkSec / 60)}m`,
                s.talkSec ? null : "from logged durations",
              ],
              ["Tasks done today", s.tasksDoneToday, null],
            ] as const
          ).map(([label, value, hint]) => (
            <div
              key={label}
              className="rounded-[6px] border border-line bg-surface px-4 py-3"
            >
              <div className="text-[22px] font-medium tabular-nums">
                {value}
              </div>
              <div className="text-[12px] text-ink-muted">{label}</div>
              {hint && (
                <div className="text-[11px] text-ink-subtle">{hint}</div>
              )}
            </div>
          ))}
        </section>

        <div className="grid gap-3 lg:grid-cols-2">
          <div className="space-y-3">
            <Card
              title="My tasks due today and overdue"
              count={data.taskCounts.today + data.taskCounts.overdue}
              actions={
                <Link
                  href="/tasks"
                  className="text-[13px] text-link hover:underline"
                >
                  All tasks
                </Link>
              }
            >
              {data.tasks.length ? (
                <ul>
                  {data.tasks.map((t) => {
                    const overdue =
                      t.dueAt && new Date(t.dueAt).getTime() < startToday;
                    const late =
                      t.dueAt && new Date(t.dueAt).getTime() < Date.now();
                    return (
                      <li
                        key={t.id}
                        className="flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0"
                      >
                        <button
                          onClick={() => complete(t.id, t.title)}
                          aria-label={`Complete ${t.title}`}
                          className="mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border-2 border-line-strong text-transparent hover:border-[#00bda5] hover:text-[#00bda5]"
                        >
                          <Check className="size-3" strokeWidth={3} />
                        </button>
                        <div className="min-w-0 flex-1 text-[13px]">
                          <div className="font-medium">{t.title}</div>
                          <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-muted">
                            {t.contact && (
                              <Link
                                href={`/contacts/${t.contact.id}`}
                                className="text-link hover:underline"
                              >
                                {t.contact.name}
                              </Link>
                            )}
                            {t.company && (
                              <Link
                                href={`/companies/${t.company.id}`}
                                className="hover:underline"
                              >
                                {t.company.name}
                              </Link>
                            )}
                            {t.taskType && <span>{t.taskType}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-[12px]">
                          <div
                            className={cn(
                              late
                                ? "font-medium text-danger"
                                : "text-ink-muted",
                            )}
                          >
                            {overdue
                              ? friendlyDateTime(t.dueAt)
                              : time(t.dueAt)}
                          </div>
                          {t.priority === "High" && (
                            <Pill label="High" color="#f2545b" />
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>Nothing due today and nothing overdue.</Empty>
              )}
            </Card>

            <Card title="Today's meetings" count={data.meetings.length}>
              {data.meetings.length ? (
                <ul>
                  {data.meetings.map((m) => {
                    const past = m.endAt
                      ? new Date(m.endAt).getTime() < Date.now()
                      : m.startAt
                        ? new Date(m.startAt).getTime() < Date.now()
                        : false;
                    return (
                      <li
                        key={m.id}
                        className={cn(
                          "flex items-start gap-3 border-b border-line px-4 py-2.5 last:border-b-0",
                          past && "opacity-60",
                        )}
                      >
                        <div className="w-[72px] shrink-0 text-[13px] font-medium tabular-nums">
                          {time(m.startAt)}
                          {m.endAt && (
                            <div className="text-[11px] font-normal text-ink-subtle">
                              to {time(m.endAt)}
                            </div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1 text-[13px]">
                          <div className="font-medium">{m.title}</div>
                          <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-muted">
                            {m.contact && (
                              <Link
                                href={`/contacts/${m.contact.id}`}
                                className="text-link hover:underline"
                              >
                                {m.contact.name}
                              </Link>
                            )}
                            {m.company && (
                              <Link
                                href={`/companies/${m.company.id}`}
                                className="hover:underline"
                              >
                                {m.company.name}
                              </Link>
                            )}
                            {m.meetingType && <span>{m.meetingType}</span>}
                          </div>
                          {m.location &&
                            (/^https?:\/\//.test(m.location) ? (
                              <a
                                href={m.location}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1 text-[12px] text-link hover:underline"
                              >
                                Join <ExternalLink className="size-3" />
                              </a>
                            ) : (
                              <div className="text-[12px] text-ink-subtle">
                                {m.location}
                              </div>
                            ))}
                        </div>
                        {m.meetingOutcome && <Pill label={m.meetingOutcome} />}
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <Empty>
                  <CalendarDays className="mr-1 inline size-4" />
                  No meetings today. Meetings you log or schedule on a record
                  show here.
                </Empty>
              )}
            </Card>

            <Card
              title="My calls, last 7 days"
              actions={
                <span className="text-[12px] text-ink-subtle">
                  {s.week.calls} calls
                </span>
              }
            >
              <div
                className="flex items-end gap-2 px-4 pt-4"
                style={{ height: 130 }}
                aria-label="Calls per day"
              >
                {s.perDay.map((d) => (
                  <div
                    key={d.day}
                    className="flex flex-1 flex-col items-center justify-end gap-1"
                    title={`${d.day}: ${d.calls} calls, ${d.connects} connects`}
                  >
                    <span className="text-[11px] tabular-nums text-ink-muted">
                      {d.calls || ""}
                    </span>
                    <div
                      className="flex w-full max-w-[36px] flex-col justify-end overflow-hidden rounded-t-[3px] bg-[#9fd8e3]"
                      style={{
                        height: `${(d.calls / maxDay) * 80}px`,
                        minHeight: d.calls ? 4 : 0,
                      }}
                    >
                      <div
                        className="bg-[#00bda5]"
                        style={{
                          height: d.calls
                            ? `${(d.connects / d.calls) * 100}%`
                            : 0,
                        }}
                      />
                    </div>
                  </div>
                ))}
              </div>
              <div className="flex gap-2 px-4 pb-1">
                {s.perDay.map((d, i) => (
                  <div
                    key={d.day}
                    className={cn(
                      "flex-1 text-center text-[11px]",
                      i === 6 ? "font-semibold" : "text-ink-subtle",
                    )}
                  >
                    {i === 6 ? "Today" : weekday(d.day)}
                  </div>
                ))}
              </div>
              <div className="flex items-center gap-3 px-4 pb-2 text-[11px] text-ink-subtle">
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-[#9fd8e3]" /> Calls
                </span>
                <span className="flex items-center gap-1">
                  <span className="size-2 rounded-sm bg-[#00bda5]" /> Connected
                </span>
              </div>
              {s.outcomes.length > 0 ? (
                <div className="space-y-1 border-t border-line px-4 py-3">
                  {s.outcomes.map((o) => (
                    <div
                      key={o.result}
                      className="flex items-center gap-2 text-[12px]"
                    >
                      <span className="w-[160px] shrink-0 truncate">
                        {o.result}
                      </span>
                      <span className="flex-1">
                        <span
                          className="block h-2 rounded-full bg-[#ff8f59]"
                          style={{
                            width: `${(o.count / s.outcomes[0].count) * 100}%`,
                            minWidth: 4,
                          }}
                        />
                      </span>
                      <span className="w-6 text-right tabular-nums text-ink-muted">
                        {o.count}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <Empty>No calls logged in the last 7 days.</Empty>
              )}
            </Card>
          </div>

          <div className="space-y-3">
            <Card title="My follow-ups" count={data.followUps.length}>
              {data.followUps.length ? (
                followGroups.map(([label, list]) =>
                  list.length ? (
                    <div key={label}>
                      <div
                        className={cn(
                          "bg-surface-muted px-4 py-1 text-[11px] font-semibold uppercase tracking-wide",
                          label === "Overdue"
                            ? "text-danger"
                            : "text-ink-subtle",
                        )}
                      >
                        {label} ({list.length})
                      </div>
                      <ul>
                        {list.map((f, i) => (
                          <li
                            key={`${f.kind}${f.id}${f.campaign?.id ?? ""}${i}`}
                            className="flex items-start gap-3 border-b border-line px-4 py-2 last:border-b-0"
                          >
                            {f.kind === "contact" ? (
                              <UserRound className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                            ) : (
                              <Building2 className="mt-0.5 size-4 shrink-0 text-ink-subtle" />
                            )}
                            <div className="min-w-0 flex-1 text-[13px]">
                              <Link
                                href={`/${f.kind === "contact" ? "contacts" : "companies"}/${f.id}`}
                                className="font-medium text-link hover:underline"
                              >
                                {f.name}
                              </Link>
                              {f.subtitle && (
                                <div className="truncate text-[12px] text-ink-muted">
                                  {f.subtitle}
                                </div>
                              )}
                              <div className="flex flex-wrap gap-x-2 text-[12px] text-ink-subtle">
                                {f.campaign ? (
                                  <Link
                                    href={`/prospecting/${f.campaign.id}?id=${f.id}`}
                                    className="text-link hover:underline"
                                  >
                                    Campaign callback · {f.campaign.name}
                                  </Link>
                                ) : (
                                  <span>
                                    Next follow-up
                                    {f.detail ? ` · ${f.detail}` : ""}
                                  </span>
                                )}
                                {f.timeZone && (
                                  <LocalTime
                                    tz={f.timeZone}
                                    suffix="their time"
                                  />
                                )}
                              </div>
                            </div>
                            <span
                              className={cn(
                                "shrink-0 text-[12px]",
                                label === "Overdue"
                                  ? "font-medium text-danger"
                                  : "text-ink-muted",
                              )}
                            >
                              {friendlyDateTime(f.at)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )
              ) : (
                <Empty>
                  No follow-ups due in the next 7 days on records you own or
                  campaign companies assigned to you.
                </Empty>
              )}
            </Card>

            <Card title="Recently viewed">
              {data.recent.length ? (
                <ul>
                  {data.recent.map((r) => (
                    <li key={`${r.kind}${r.id}`}>
                      <Link
                        href={`/${r.kind === "contact" ? "contacts" : "companies"}/${r.id}`}
                        className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-b-0 hover:bg-surface-hover"
                      >
                        {r.kind === "company" ? (
                          <CompanyLogo
                            name={r.name}
                            domain={r.domain}
                            size={24}
                          />
                        ) : (
                          <span className="flex size-6 items-center justify-center rounded-full bg-surface-muted">
                            <UserRound className="size-3.5 text-ink-muted" />
                          </span>
                        )}
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[13px] font-medium text-link">
                            {r.name}
                          </span>
                          {r.subtitle && (
                            <span className="block truncate text-[12px] text-ink-muted">
                              {r.subtitle}
                            </span>
                          )}
                        </span>
                        <span className="shrink-0 text-[12px] text-ink-subtle">
                          {friendlyDateTime(r.viewedAt)}
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <Empty>Contacts and companies you open show here.</Empty>
              )}
            </Card>
          </div>
        </div>
      </div>

      {toast && (
        <div
          role="status"
          className="fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 items-center gap-4 rounded-[4px] bg-[#2d3e50] px-4 py-2.5 text-[13px] text-white shadow-lg"
        >
          {toast.message}
          {toast.undo && (
            <button
              className="font-medium underline"
              onClick={async () => {
                await toast.undo!();
                setToast({ message: "Undone" });
                router.refresh();
              }}
            >
              Undo
            </button>
          )}
          <button onClick={() => setToast(null)} aria-label="Dismiss">
            <X className="size-3.5" />
          </button>
        </div>
      )}
    </div>
  );
}
