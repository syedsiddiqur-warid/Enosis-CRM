// Tasks page and "Start tasks" queue: filters, tab boundaries and loading. Server-only.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { dayRange } from "./dates";
import type { PropOption, UserLite } from "./types";

export type TaskTab = "today" | "overdue" | "upcoming" | "open" | "completed";
export const TASK_TABS: TaskTab[] = ["today", "overdue", "upcoming", "open", "completed"];

export interface TaskSearchParams {
  tab?: string;
  assignee?: string;
  type?: string;
  priority?: string;
  queue?: string;
  q?: string;
  page?: string;
  view?: string;
  id?: string;
}

const PAGE_SIZE = 50;
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

function today() {
  return dayRange(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(new Date()));
}

/** Filters shared by the list, the board, the tab counts and the Start tasks queue (everything except the tab). */
export function taskFilterWhere(sp: TaskSearchParams, userId: string): Prisma.ActivityWhereInput {
  const assignee = sp.assignee ?? "me";
  const q = sp.q?.trim();
  return {
    type: "TASK",
    deletedAt: null,
    ...(assignee === "me" ? { assigneeId: userId } : assignee === "unassigned" ? { assigneeId: null } : assignee === "all" ? {} : { assigneeId: assignee }),
    ...(sp.type ? { taskType: sp.type } : {}),
    ...(sp.priority ? { priority: sp.priority } : {}),
    ...(sp.queue === "none" ? { queueId: null } : sp.queue ? { queueId: sp.queue } : {}),
    ...(q
      ? {
          OR: [
            { title: { contains: q, mode: "insensitive" } },
            { contacts: { some: { contact: { OR: [{ firstName: { contains: q, mode: "insensitive" } }, { lastName: { contains: q, mode: "insensitive" } }] } } } },
            { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } },
          ],
        }
      : {}),
  };
}

export function tabWhere(tab: TaskTab): Prisma.ActivityWhereInput {
  const [start, end] = today();
  const open: Prisma.ActivityWhereInput = { taskStatus: { not: "COMPLETED" } };
  switch (tab) {
    case "today":
      return { ...open, dueAt: { gte: start, lte: end } };
    case "overdue":
      return { ...open, dueAt: { lt: start } };
    case "upcoming":
      return { ...open, dueAt: { gt: end } };
    case "open":
      return open;
    case "completed":
      return { taskStatus: "COMPLETED" };
  }
}

export const parseTab = (t: string | undefined): TaskTab => (TASK_TABS.includes(t as TaskTab) ? (t as TaskTab) : "today");

const include = {
  assignee: { select: { id: true, name: true } },
  queue: { select: { id: true, name: true } },
  contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, timeZone: true } } } },
  companies: { select: { company: { select: { id: true, name: true, domain: true, timeZone: true } } } },
} satisfies Prisma.ActivityInclude;

type TaskRow = Prisma.ActivityGetPayload<{ include: typeof include }>;

export function toTask(t: TaskRow) {
  const contact = t.contacts[0]?.contact ?? null;
  const company = t.companies[0]?.company ?? null;
  return {
    id: t.id,
    title: t.title ?? "(untitled task)",
    body: t.body,
    taskType: t.taskType,
    priority: t.priority,
    taskStatus: t.taskStatus ?? "NOT_STARTED",
    dueAt: iso(t.dueAt),
    completedAt: iso(t.completedAt),
    createdAt: t.createdAt.toISOString(),
    ownerId: t.ownerId,
    assignee: t.assignee,
    queue: t.queue,
    contact: contact ? { id: contact.id, name: fullName(contact), jobTitle: contact.jobTitle } : null,
    company: company ? { id: company.id, name: company.name, domain: company.domain } : null,
    timeZone: contact?.timeZone ?? company?.timeZone ?? null,
  };
}

export type TaskItem = ReturnType<typeof toTask>;

async function optionList(key: string) {
  const l = await db.optionList.findUnique({ where: { key } });
  return ((l?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);
}

export async function taskOptions(userId: string) {
  const [users, types, priorities, queues] = await Promise.all([
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    optionList("taskType"),
    optionList("taskPriority"),
    db.taskQueue.findMany({ where: { OR: [{ shared: true }, { ownerId: userId }, { ownerId: null }] }, orderBy: { name: "asc" }, select: { id: true, name: true, shared: true, ownerId: true } }),
  ]);
  return { users: users as UserLite[], types, priorities, queues };
}

export async function loadTasks(userId: string, sp: TaskSearchParams) {
  const tab = parseTab(sp.tab);
  const view = sp.view === "board" ? "board" : "list";
  const page = Math.max(1, Number(sp.page) || 1);
  const base = taskFilterWhere(sp, userId);
  const where: Prisma.ActivityWhereInput = { AND: [base, tabWhere(tab)] };
  const [rows, total, counts, opts, me] = await Promise.all([
    db.activity.findMany({
      where,
      include,
      orderBy: tab === "completed" ? [{ completedAt: "desc" }] : [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }],
      skip: view === "board" ? 0 : (page - 1) * PAGE_SIZE,
      take: view === "board" ? 300 : PAGE_SIZE,
    }),
    db.activity.count({ where }),
    Promise.all(TASK_TABS.map(async (t) => [t, await db.activity.count({ where: { AND: [base, tabWhere(t)] } })] as const)),
    taskOptions(userId),
    db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } }),
  ]);
  return {
    tasks: rows.map(toTask),
    total,
    page,
    pageSize: PAGE_SIZE,
    tab,
    view,
    counts: Object.fromEntries(counts) as Record<TaskTab, number>,
    filters: { assignee: sp.assignee ?? "me", type: sp.type ?? "", priority: sp.priority ?? "", queue: sp.queue ?? "", q: sp.q ?? "" },
    ...opts,
    currentUserId: userId,
    isManager: ["Admin", "Manager"].includes(me?.role?.name ?? ""),
  };
}

export type TasksData = Awaited<ReturnType<typeof loadTasks>>;

/** Start tasks: the open tasks of the chosen tab and filters, worked one at a time with the record beside them. */
export async function loadTaskQueue(userId: string, sp: TaskSearchParams) {
  const tab = parseTab(sp.tab ?? "today");
  const where: Prisma.ActivityWhereInput = { AND: [taskFilterWhere(sp, userId), tab === "completed" ? tabWhere("open") : tabWhere(tab)] };
  const rows = await db.activity.findMany({ where, include, orderBy: [{ dueAt: { sort: "asc", nulls: "last" } }, { createdAt: "asc" }], take: 500 });
  const tasks = rows.map(toTask);
  const current = tasks.find((t) => t.id === sp.id) ?? tasks[0] ?? null;
  const [opts, record, outcomes, paths, followUpRules] = await Promise.all([
    taskOptions(userId),
    current ? loadTaskRecord(current) : null,
    optionList("callResult"),
    optionList("callPath"),
    db.followUpRule.findMany({ where: { isActive: true }, select: { callResult: true, taskTitle: true, taskType: true, dueInDays: true } }),
  ]);
  return {
    tab,
    filters: { assignee: sp.assignee ?? "me", type: sp.type ?? "", priority: sp.priority ?? "", queue: sp.queue ?? "", q: sp.q ?? "" },
    tasks,
    current,
    record,
    outcomes,
    paths,
    followUpRules,
    ...opts,
    currentUserId: userId,
  };
}

export type TaskQueueData = Awaited<ReturnType<typeof loadTaskQueue>>;

/** The contact (or company) a task is about, with what's needed to call or email them. */
async function loadTaskRecord(task: TaskItem) {
  const contactId = task.contact?.id ?? null;
  let companyId = task.company?.id ?? null;
  const contact = contactId
    ? await db.contact.findUnique({
        where: { id: contactId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          jobTitle: true,
          phone: true,
          mobile: true,
          timeZone: true,
          leadStatus: true,
          callStatus: true,
          crtCount: true,
          doNotCall: true,
          companies: { where: { isPrimary: true }, select: { companyId: true }, take: 1 },
        },
      })
    : null;
  companyId ??= contact?.companies[0]?.companyId ?? null;
  const company = companyId ? await db.company.findUnique({ where: { id: companyId }, select: { id: true, name: true, domain: true, timeZone: true, leadState: true, crtCount: true, callStatus: true } }) : null;
  const [phones, activities, campaigns] = await Promise.all([
    db.phoneNumber.findMany({
      where: { OR: [...(contactId ? [{ contactId }] : []), ...(companyId ? [{ companyId, contactId: null }] : [])] },
      orderBy: [{ contactId: "desc" }, { createdAt: "asc" }],
    }),
    db.activity.findMany({
      where: {
        deletedAt: null,
        type: { in: ["CALL", "EMAIL", "NOTE", "MEETING"] },
        OR: [...(contactId ? [{ contacts: { some: { contactId } } }] : []), ...(companyId ? [{ companies: { some: { companyId } } }] : [])],
      },
      select: { id: true, type: true, occurredAt: true, callResult: true, callPath: true, subject: true, title: true, body: true, owner: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 8,
    }),
    companyId
      ? db.campaignCompany.findMany({ where: { companyId, removedAt: null, campaign: { status: { in: ["ACTIVE", "PAUSED"] } } }, select: { campaign: { select: { id: true, name: true, pitch: true } }, status: true } })
      : [],
  ]);
  return {
    /** Calls and notes are logged on the contact when there is one, otherwise on the company */
    object: contact ? ("CONTACT" as const) : ("COMPANY" as const),
    id: contact?.id ?? company?.id ?? null,
    contact: contact
      ? {
          id: contact.id,
          name: fullName(contact),
          email: contact.email,
          jobTitle: contact.jobTitle,
          phone: contact.phone,
          mobile: contact.mobile,
          leadStatus: contact.leadStatus,
          callStatus: contact.callStatus,
          crtCount: contact.crtCount,
          doNotCall: contact.doNotCall,
        }
      : null,
    company,
    timeZone: contact?.timeZone ?? company?.timeZone ?? null,
    phones: phones.map((p) => ({ id: p.id, number: p.number, extension: p.extension, type: p.type, ivrPath: p.ivrPath, status: p.status, own: p.contactId === contactId && !!contactId })),
    activities: activities.map((a) => ({
      id: a.id,
      type: a.type,
      at: a.occurredAt.toISOString(),
      title: a.type === "CALL" ? `Call: ${a.callResult ?? "logged"}${a.callPath ? ` via ${a.callPath}` : ""}` : a.type === "EMAIL" ? `Email: ${a.subject ?? "(no subject)"}` : a.type === "MEETING" ? `Meeting: ${a.title ?? ""}` : "Note",
      body: a.body?.replace(/<[^>]+>/g, "").slice(0, 300) ?? null,
      by: a.owner?.name ?? null,
    })),
    campaigns: campaigns.map((c) => ({ id: c.campaign.id, name: c.campaign.name, pitch: c.campaign.pitch, status: c.status })),
  };
}
