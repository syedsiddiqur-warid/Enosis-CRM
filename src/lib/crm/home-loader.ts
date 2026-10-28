// Home page: the signed-in user's day. Server-only.
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { OPEN_STATUSES } from "./calling-queue";
import { dayRange } from "./dates";

const TZ = "Asia/Dhaka";
const dayKey = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export async function loadHome(userId: string) {
  const todayKey = dayKey(new Date());
  const [startToday, endToday] = dayRange(todayKey);
  const weekAgo = dayRange(dayKey(new Date(Date.now() - 6 * 864e5)))[0];
  const weekAhead = dayRange(dayKey(new Date(Date.now() + 7 * 864e5)))[1];
  const now = new Date();

  const [me, tasks, taskCounts, contactFollowUps, companyFollowUps, campaignDue, meetings, calls, tasksDoneToday, recents] = await Promise.all([
    db.user.findUnique({ where: { id: userId }, select: { name: true, email: true } }),
    db.activity.findMany({
      where: { type: "TASK", deletedAt: null, assigneeId: userId, taskStatus: { not: "COMPLETED" }, dueAt: { lte: endToday } },
      include: {
        contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        companies: { select: { company: { select: { id: true, name: true } } } },
      },
      orderBy: { dueAt: "asc" },
      take: 25,
    }),
    Promise.all([
      db.activity.count({ where: { type: "TASK", deletedAt: null, assigneeId: userId, taskStatus: { not: "COMPLETED" }, dueAt: { lt: startToday } } }),
      db.activity.count({ where: { type: "TASK", deletedAt: null, assigneeId: userId, taskStatus: { not: "COMPLETED" }, dueAt: { gte: startToday, lte: endToday } } }),
    ]),
    // Follow-ups: the "Next follow-up" date on records I own, overdue up to a week ahead
    db.contact.findMany({
      where: { deletedAt: null, ownerId: userId, nextFollowUpAt: { lte: weekAhead } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        jobTitle: true,
        nextFollowUpAt: true,
        leadStatus: true,
        timeZone: true,
        companies: { where: { isPrimary: true }, select: { company: { select: { id: true, name: true, timeZone: true } } }, take: 1 },
      },
      orderBy: { nextFollowUpAt: "asc" },
      take: 30,
    }),
    db.company.findMany({
      where: { deletedAt: null, ownerId: userId, nextFollowUpAt: { lte: weekAhead } },
      select: { id: true, name: true, nextFollowUpAt: true, leadState: true, timeZone: true },
      orderBy: { nextFollowUpAt: "asc" },
      take: 30,
    }),
    // Campaign callbacks: companies assigned to me whose next action has come
    db.campaignCompany.findMany({
      where: { assignedToId: userId, removedAt: null, status: { in: OPEN_STATUSES }, nextActionAt: { lte: endToday }, campaign: { status: "ACTIVE" }, company: { deletedAt: null } },
      select: { nextActionAt: true, lastResult: true, attempts: true, campaign: { select: { id: true, name: true } }, company: { select: { id: true, name: true, timeZone: true } } },
      orderBy: { nextActionAt: "asc" },
      take: 30,
    }),
    db.activity.findMany({
      where: { type: "MEETING", deletedAt: null, OR: [{ ownerId: userId }, { assigneeId: userId }], startAt: { gte: startToday, lte: endToday } },
      select: {
        id: true,
        title: true,
        startAt: true,
        endAt: true,
        location: true,
        meetingType: true,
        meetingOutcome: true,
        contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } },
        companies: { select: { company: { select: { id: true, name: true } } } },
      },
      orderBy: { startAt: "asc" },
    }),
    db.activity.findMany({
      where: { type: "CALL", deletedAt: null, ownerId: userId, occurredAt: { gte: weekAgo, lte: now } },
      select: { occurredAt: true, callResult: true, durationSec: true },
    }),
    db.activity.count({ where: { type: "TASK", deletedAt: null, assigneeId: userId, completedAt: { gte: startToday, lte: endToday } } }),
    db.recentView.findMany({ where: { userId }, orderBy: { viewedAt: "desc" }, take: 12 }),
  ]);

  // Calls per day for the last 7 days (Dhaka days), oldest first
  const days = Array.from({ length: 7 }, (_, i) => dayKey(new Date(Date.now() - (6 - i) * 864e5)));
  const perDay = days.map((d) => {
    const list = calls.filter((c) => dayKey(c.occurredAt) === d);
    return { day: d, calls: list.length, connects: list.filter((c) => /^connected|meeting/i.test(c.callResult ?? "")).length };
  });
  const today = perDay.at(-1)!;
  const week = perDay.reduce((s, d) => ({ calls: s.calls + d.calls, connects: s.connects + d.connects }), { calls: 0, connects: 0 });
  const outcomes = Object.entries(
    calls.reduce<Record<string, number>>((m, c) => {
      const k = c.callResult ?? "Not recorded";
      m[k] = (m[k] ?? 0) + 1;
      return m;
    }, {}),
  )
    .map(([result, count]) => ({ result, count }))
    .sort((a, b) => b.count - a.count);
  const meetingsBooked = calls.filter((c) => c.callResult === "Meeting Booked").length;
  const talkSec = calls.filter((c) => dayKey(c.occurredAt) === todayKey).reduce((s, c) => s + (c.durationSec ?? 0), 0);

  // Recently viewed: resolve names, drop records deleted since
  const contactIds = recents.filter((r) => r.objectType === "CONTACT").map((r) => r.recordId);
  const companyIds = recents.filter((r) => r.objectType === "COMPANY").map((r) => r.recordId);
  const [rc, rco] = await Promise.all([
    db.contact.findMany({
      where: { id: { in: contactIds }, deletedAt: null },
      select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, companies: { where: { isPrimary: true }, select: { company: { select: { name: true } } }, take: 1 } },
    }),
    db.company.findMany({ where: { id: { in: companyIds }, deletedAt: null }, select: { id: true, name: true, domain: true, leadState: true } }),
  ]);
  const recent = recents
    .map((r) => {
      if (r.objectType === "CONTACT") {
        const c = rc.find((x) => x.id === r.recordId);
        return c ? { kind: "contact" as const, id: c.id, name: fullName(c), subtitle: [c.jobTitle, c.companies[0]?.company.name].filter(Boolean).join(" at ") || null, domain: null, viewedAt: r.viewedAt.toISOString() } : null;
      }
      if (r.objectType === "COMPANY") {
        const c = rco.find((x) => x.id === r.recordId);
        return c ? { kind: "company" as const, id: c.id, name: c.name, subtitle: c.leadState, domain: c.domain, viewedAt: r.viewedAt.toISOString() } : null;
      }
      return null;
    })
    .filter((r): r is NonNullable<typeof r> => !!r)
    .slice(0, 8);

  const followUps = [
    ...contactFollowUps.map((c) => ({
      kind: "contact" as const,
      id: c.id,
      name: fullName(c),
      subtitle: [c.jobTitle, c.companies[0]?.company.name].filter(Boolean).join(" at ") || null,
      at: iso(c.nextFollowUpAt)!,
      detail: c.leadStatus,
      timeZone: c.timeZone ?? c.companies[0]?.company.timeZone ?? null,
      campaign: null as { id: string; name: string } | null,
    })),
    ...companyFollowUps.map((c) => ({ kind: "company" as const, id: c.id, name: c.name, subtitle: null, at: iso(c.nextFollowUpAt)!, detail: c.leadState, timeZone: c.timeZone, campaign: null })),
    ...campaignDue.map((m) => ({
      kind: "company" as const,
      id: m.company.id,
      name: m.company.name,
      subtitle: `${m.attempts} call${m.attempts === 1 ? "" : "s"} so far${m.lastResult ? ` · last: ${m.lastResult}` : ""}`,
      at: iso(m.nextActionAt)!,
      detail: null,
      timeZone: m.company.timeZone,
      campaign: m.campaign,
    })),
  ].sort((a, b) => a.at.localeCompare(b.at));

  return {
    firstName: me?.name?.split(" ")[0] ?? me?.email.split("@")[0] ?? "there",
    todayKey,
    startToday: startToday.toISOString(),
    endToday: endToday.toISOString(),
    tasks: tasks.map((t) => ({
      id: t.id,
      title: t.title ?? "(untitled task)",
      taskType: t.taskType,
      priority: t.priority,
      dueAt: iso(t.dueAt),
      contact: t.contacts[0] ? { id: t.contacts[0].contact.id, name: fullName(t.contacts[0].contact) } : null,
      company: t.companies[0]?.company ?? null,
    })),
    taskCounts: { overdue: taskCounts[0], today: taskCounts[1] },
    followUps,
    meetings: meetings.map((m) => ({
      id: m.id,
      title: m.title ?? "Meeting",
      startAt: iso(m.startAt),
      endAt: iso(m.endAt),
      location: m.location,
      meetingType: m.meetingType,
      meetingOutcome: m.meetingOutcome,
      contact: m.contacts[0] ? { id: m.contacts[0].contact.id, name: fullName(m.contacts[0].contact) } : null,
      company: m.companies[0]?.company ?? null,
    })),
    stats: { today, week, perDay, outcomes, meetingsBooked, talkSec, tasksDoneToday },
    recent,
  };
}

export type HomeData = Awaited<ReturnType<typeof loadHome>>;
