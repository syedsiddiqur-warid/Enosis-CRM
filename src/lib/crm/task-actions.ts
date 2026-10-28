"use server";

// Tasks outside the record page: create (one or many records), edit, complete, reschedule, reassign, queue, delete.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import type { CrmObject, PropOption } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

function revalidate() {
  revalidatePath("/tasks", "layout");
  revalidatePath("/", "layout");
}

async function isManager(userId: string) {
  const me = await db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } });
  return ["Admin", "Manager"].includes(me?.role?.name ?? "");
}

/** Tasks this user may change: ones they created or are assigned, or any for managers and admins. */
async function editable(ids: string[], userId: string) {
  const tasks = await db.activity.findMany({ where: { id: { in: ids }, type: "TASK", deletedAt: null }, select: { id: true, ownerId: true, assigneeId: true } });
  if (tasks.length !== ids.length) throw new Error("Some tasks no longer exist");
  if (!(await isManager(userId)) && tasks.some((t) => t.ownerId !== userId && t.assigneeId !== userId)) {
    throw new Error("You can only change tasks you created or are assigned to");
  }
  return tasks;
}

async function listValues(key: string) {
  const l = await db.optionList.findUnique({ where: { key } });
  return ((l?.options as PropOption[] | null) ?? []).map((o) => o.value);
}

const STATUSES = ["NOT_STARTED", "IN_PROGRESS", "WAITING", "COMPLETED"] as const;
type Status = (typeof STATUSES)[number];

export interface TaskInput {
  title: string;
  body?: string | null;
  taskType?: string | null;
  priority?: string | null;
  dueAt: string;
  assigneeId?: string | null;
  queueId?: string | null;
  contactId?: string | null;
  companyId?: string | null;
}

async function cleanInput(input: Partial<TaskInput>, full: boolean) {
  const data: Prisma.ActivityUncheckedUpdateInput = {};
  if (full || input.title !== undefined) {
    const t = input.title?.trim();
    if (!t) throw new Error("Give the task a title");
    data.title = t.slice(0, 200);
  }
  if (input.body !== undefined) data.body = input.body?.trim() || null;
  if (full || input.dueAt !== undefined) {
    const d = new Date(input.dueAt ?? "");
    if (Number.isNaN(d.getTime())) throw new Error("Set a due date");
    data.dueAt = d;
  }
  if (input.taskType !== undefined) {
    const types = await listValues("taskType");
    if (input.taskType && types.length && !types.includes(input.taskType)) throw new Error("Unknown task type");
    data.taskType = input.taskType || "To-do";
  }
  if (input.priority !== undefined) {
    const p = await listValues("taskPriority");
    if (input.priority && p.length && !p.includes(input.priority)) throw new Error("Unknown priority");
    data.priority = input.priority || null;
  }
  if (input.assigneeId !== undefined) {
    if (input.assigneeId && !(await db.user.count({ where: { id: input.assigneeId, isActive: true } }))) throw new Error("Unknown user");
    data.assigneeId = input.assigneeId || null;
  }
  if (input.queueId !== undefined) data.queueId = input.queueId || null;
  return data;
}

export async function createTask(input: TaskInput): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const data = await cleanInput({ taskType: "To-do", ...input }, true);
    let companyId = input.companyId || null;
    if (input.contactId && !companyId) {
      companyId = (await db.contactCompany.findFirst({ where: { contactId: input.contactId, isPrimary: true }, select: { companyId: true } }))?.companyId ?? null;
    }
    const t = await db.activity.create({
      data: {
        ...(data as Prisma.ActivityUncheckedCreateInput),
        type: "TASK",
        taskStatus: "NOT_STARTED",
        ownerId: user.id,
        assigneeId: (data.assigneeId as string | null | undefined) ?? user.id,
        contacts: input.contactId ? { create: { contactId: input.contactId } } : undefined,
        companies: companyId ? { create: { companyId } } : undefined,
      },
    });
    revalidate();
    return { ok: true, data: { id: t.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Bulk bar "Create tasks": one task per selected contact or company. */
export async function createTasksFor(object: CrmObject, recordIds: string[], input: Omit<TaskInput, "contactId" | "companyId">): Promise<Result<{ created: number }>> {
  try {
    const user = await requireUser();
    if (!recordIds.length) throw new Error("Select records first");
    if (recordIds.length > 500) throw new Error("Create tasks for up to 500 records at a time");
    const data = await cleanInput({ taskType: "To-do", ...input }, true);
    const primaries =
      object === "CONTACT"
        ? new Map((await db.contactCompany.findMany({ where: { contactId: { in: recordIds }, isPrimary: true }, select: { contactId: true, companyId: true } })).map((l) => [l.contactId, l.companyId]))
        : new Map<string, string>();
    for (const id of recordIds) {
      const companyId = object === "COMPANY" ? id : primaries.get(id);
      await db.activity.create({
        data: {
          ...(data as Prisma.ActivityUncheckedCreateInput),
          type: "TASK",
          taskStatus: "NOT_STARTED",
          ownerId: user.id,
          assigneeId: (data.assigneeId as string | null | undefined) ?? user.id,
          ...(object === "CONTACT" ? { contacts: { create: { contactId: id } } } : {}),
          ...(companyId ? { companies: { create: { companyId } } } : {}),
        },
      });
    }
    revalidate();
    return { ok: true, data: { created: recordIds.length } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateTask(id: string, patch: Partial<TaskInput> & { taskStatus?: Status }): Promise<Result> {
  try {
    const user = await requireUser();
    await editable([id], user.id);
    const data = await cleanInput(patch, false);
    if (patch.taskStatus) {
      if (!STATUSES.includes(patch.taskStatus)) throw new Error("Unknown status");
      data.taskStatus = patch.taskStatus;
      data.completedAt = patch.taskStatus === "COMPLETED" ? new Date() : null;
    }
    await db.activity.update({ where: { id }, data });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTasksDone(ids: string[], done: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    await editable(ids, user.id);
    await db.activity.updateMany({ where: { id: { in: ids } }, data: { taskStatus: done ? "COMPLETED" : "NOT_STARTED", completedAt: done ? new Date() : null } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Move tasks to a new due time, or by N days keeping their time of day. Returns the old due dates for undo. */
export async function rescheduleTasks(ids: string[], to: { at?: string; days?: number }): Promise<Result<{ previous: Record<string, string | null> }>> {
  try {
    const user = await requireUser();
    await editable(ids, user.id);
    const rows = await db.activity.findMany({ where: { id: { in: ids } }, select: { id: true, dueAt: true } });
    const at = to.at ? new Date(to.at) : null;
    if (to.at && Number.isNaN(at!.getTime())) throw new Error("Invalid date");
    for (const r of rows) {
      const due = at ?? new Date((r.dueAt ?? new Date()).getTime() + (to.days ?? 1) * 864e5);
      await db.activity.update({ where: { id: r.id }, data: { dueAt: due } });
    }
    revalidate();
    return { ok: true, data: { previous: Object.fromEntries(rows.map((r) => [r.id, r.dueAt?.toISOString() ?? null])) } };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreDueDates(previous: Record<string, string | null>): Promise<Result> {
  try {
    const user = await requireUser();
    await editable(Object.keys(previous), user.id);
    for (const [id, due] of Object.entries(previous)) await db.activity.update({ where: { id }, data: { dueAt: due ? new Date(due) : null } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function assignTasks(ids: string[], assigneeId: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    await editable(ids, user.id);
    if (assigneeId && !(await db.user.count({ where: { id: assigneeId, isActive: true } }))) throw new Error("Unknown user");
    await db.activity.updateMany({ where: { id: { in: ids } }, data: { assigneeId } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTasksQueue(ids: string[], queueId: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    await editable(ids, user.id);
    await db.activity.updateMany({ where: { id: { in: ids } }, data: { queueId } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Soft delete (restorable with undo). */
export async function deleteTasks(ids: string[], restore = false): Promise<Result> {
  try {
    const user = await requireUser();
    const tasks = await db.activity.findMany({ where: { id: { in: ids }, type: "TASK" }, select: { ownerId: true, assigneeId: true } });
    if (!(await isManager(user.id)) && tasks.some((t) => t.ownerId !== user.id && t.assigneeId !== user.id)) throw new Error("You can only delete tasks you created or are assigned to");
    await db.activity.updateMany({ where: { id: { in: ids }, type: "TASK" }, data: { deletedAt: restore ? null : new Date() } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Task queues ──

export async function createTaskQueue(name: string, shared: boolean): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const n = name.trim();
    if (!n) throw new Error("Name the queue");
    const q = await db.taskQueue.create({ data: { name: n.slice(0, 80), shared, ownerId: user.id } });
    revalidate();
    return { ok: true, data: { id: q.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteTaskQueue(id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const q = await db.taskQueue.findUniqueOrThrow({ where: { id } });
    if (q.ownerId !== user.id && !(await isManager(user.id))) throw new Error("Only the queue's owner, managers or admins can delete it");
    await db.taskQueue.delete({ where: { id } }); // tasks stay; their queue is cleared
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
