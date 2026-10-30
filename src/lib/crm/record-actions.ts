"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { bulkDelete } from "./actions";
import { runActivityRules } from "./automation";
import { syncCompaniesFromPeople } from "./campaigns";
import { OBJECT_LABELS } from "./defaults";
import { STAGE, memberStatusForCall, nextCallStatus, phoneStatusForCall, stageForCall } from "./journey";
import { advanceJourney } from "./record-writes";
import { collapsedKey, followKey, keyInfoKey } from "./record-loader";
import type { ActivityInput } from "./record-types";
import type { CrmObject } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;

function revalidate(object: CrmObject, id?: string) {
  revalidatePath(OBJECT_LABELS[object].path, "layout");
  if (id) revalidatePath(`${OBJECT_LABELS[object].path}/${id}`);
}

const date = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
};
const text = (v: string | null | undefined) => (v?.trim() ? v.trim() : null);
const emails = (list: string[] | undefined) => (list ?? []).map((e) => e.trim()).filter(Boolean);

async function roleName(userId: string) {
  return (await db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } }))?.role?.name ?? null;
}

/** Fields for one activity type, validated. Shared by create and edit. */
function activityFields(input: ActivityInput): Prisma.ActivityUncheckedCreateInput {
  const base = { type: input.type, body: text(input.body) };
  switch (input.type) {
    case "NOTE":
      if (!base.body) throw new Error("Write a note first");
      return { ...base, occurredAt: date(input.occurredAt) ?? new Date() };
    case "EMAIL":
      if (!text(input.subject) && !base.body) throw new Error("Add a subject or body");
      return {
        ...base,
        occurredAt: date(input.occurredAt) ?? new Date(),
        subject: text(input.subject),
        emailTo: emails(input.emailTo),
        emailCc: emails(input.emailCc),
        emailDirection: input.emailDirection ?? "OUTBOUND",
      };
    case "CALL":
      if (!input.callResult) throw new Error("Choose a call outcome");
      return {
        ...base,
        occurredAt: date(input.occurredAt) ?? new Date(),
        callResult: input.callResult,
        callPath: text(input.callPath),
        gatekeeperType: text(input.gatekeeperType),
        durationSec: input.durationSec ? Math.max(0, Math.round(input.durationSec)) : null,
        dialedNumber: text(input.dialedNumber),
        phoneNumberId: input.phoneNumberId || null,
        targetContactId: input.targetContactId || null,
      };
    case "TASK": {
      if (!text(input.title)) throw new Error("Give the task a title");
      const dueAt = date(input.dueAt);
      if (!dueAt) throw new Error("Set a due date");
      return {
        ...base,
        title: text(input.title),
        dueAt,
        taskType: input.taskType || "To-do",
        priority: input.priority || null,
        reminderAt: date(input.reminderAt),
        assigneeId: input.assigneeId || null,
      };
    }
    case "MEETING": {
      if (!text(input.title)) throw new Error("Give the meeting a title");
      const startAt = date(input.startAt);
      if (!startAt) throw new Error("Set a start time");
      const endAt = date(input.endAt);
      if (endAt && endAt < startAt) throw new Error("The meeting ends before it starts");
      return {
        ...base,
        title: text(input.title),
        occurredAt: startAt,
        startAt,
        endAt,
        attendees: emails(input.attendees),
        location: text(input.location),
        meetingType: input.meetingType || null,
        meetingOutcome: input.meetingOutcome || null,
      };
    }
    default:
      throw new Error("Unsupported activity");
  }
}

/** Contacts/companies an activity logged on this record links to. */
async function activityLinks(object: CrmObject, recordId: string, targetContactId?: string | null) {
  if (object === "CONTACT") {
    const primary = await db.contactCompany.findFirst({ where: { contactId: recordId, isPrimary: true }, select: { companyId: true } });
    return { contactIds: [recordId], companyIds: primary ? [primary.companyId] : [] };
  }
  if (targetContactId) {
    const link = await db.contactCompany.count({ where: { contactId: targetContactId, companyId: recordId } });
    if (!link) throw new Error("That contact isn't associated with this company");
  }
  return { contactIds: targetContactId ? [targetContactId] : [], companyIds: [recordId] };
}

export async function logActivity(object: CrmObject, recordId: string, input: ActivityInput): Promise<Result<{ id: string; automations: string[] }>> {
  try {
    const user = await requireUser();
    const fields = activityFields(input);
    const isCall = input.type === "CALL";
    const target = isCall ? (object === "CONTACT" ? recordId : input.targetContactId || null) : null;
    const { contactIds, companyIds } = await activityLinks(object, recordId, target);

    if (isCall && input.phoneNumberId) {
      const phone = await db.phoneNumber.findUnique({ where: { id: input.phoneNumberId } });
      if (!phone) throw new Error("Unknown phone number");
      fields.dialedNumber = phone.number;
    }
    if (isCall) fields.targetContactId = target;
    if (input.type === "TASK") {
      fields.taskStatus = "NOT_STARTED";
      fields.assigneeId = fields.assigneeId ?? user.id;
    }
    // Calls and meetings can be credited to a campaign the company is in
    let campaignId: string | null = null;
    if (input.campaignId && (isCall || input.type === "MEETING")) {
      const member = await db.campaignCompany.findFirst({ where: { campaignId: input.campaignId, companyId: { in: companyIds }, removedAt: null } });
      if (!member) throw new Error("This company isn't in that campaign");
      campaignId = input.campaignId;
    }

    const activity = await db.activity.create({
      data: {
        ...fields,
        campaignId,
        ownerId: user.id,
        contacts: { create: contactIds.map((contactId) => ({ contactId })) },
        companies: { create: companyIds.map((companyId) => ({ companyId })) },
      },
    });

    // Rollups: tasks and future meetings are plans, not activity, so they don't touch "last activity"/"last contacted"
    const at = fields.occurredAt ? new Date(fields.occurredAt as Date) : new Date();
    const happened = input.type !== "TASK" && at.getTime() <= Date.now();
    if (happened) {
      await db.contact.updateMany({ where: { id: { in: contactIds }, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] }, data: { lastActivityAt: at } });
      await db.company.updateMany({ where: { id: { in: companyIds }, OR: [{ lastActivityAt: null }, { lastActivityAt: { lt: at } }] }, data: { lastActivityAt: at } });
    }
    const connected = /^connected/i.test(input.callResult ?? "");
    if (isCall && target) {
      const c = await db.contact.findUniqueOrThrow({ where: { id: target }, select: { callStatus: true } });
      await db.contact.update({
        where: { id: target },
        data: {
          crtCount: { increment: 1 },
          callStatus: nextCallStatus(c.callStatus, input.callResult),
          ...(connected ? { connectedCount: { increment: 1 } } : {}),
          ...(happened ? { lastCallAt: at, lastContactedAt: at } : {}),
        },
      });
    }
    if (isCall && input.phoneNumberId) {
      // The outcome tells us whether the number works
      const status = phoneStatusForCall(input.callResult);
      await db.phoneNumber.update({ where: { id: input.phoneNumberId }, data: { lastDialedAt: at, ...(status ? { status } : {}) } });
    }

    // Company-level tracking: call rollups, campaign membership progress, lead journey
    for (const companyId of companyIds) {
      if (isCall) {
        const co = await db.company.findUniqueOrThrow({ where: { id: companyId }, select: { callStatus: true } });
        await db.company.update({
          where: { id: companyId },
          data: {
            crtCount: { increment: 1 },
            callStatus: nextCallStatus(co.callStatus, input.callResult),
            ...(connected ? { connectedCount: { increment: 1 } } : {}),
            ...(happened ? { lastCallAt: at } : {}),
          },
        });
      }
      if (campaignId) {
        const key = { campaignId_companyId: { campaignId, companyId } };
        const m = await db.campaignCompany.findUnique({ where: key, include: { campaign: { select: { audience: true } } } });
        const forPeople = m?.campaign.audience === "CONTACT";
        // Contact campaigns: the targeted person's own outcome and attempts, then the company follows its people
        if (m && forPeople && isCall && target) {
          const pKey = { campaignId_contactId: { campaignId, contactId: target } };
          const p = await db.campaignContact.findUnique({ where: pKey });
          if (p && !p.removedAt) {
            await db.campaignContact.update({
              where: pKey,
              data: {
                attempts: { increment: 1 },
                ...(connected ? { connects: { increment: 1 } } : {}),
                lastResult: input.callResult,
                status: memberStatusForCall(p.status, input.callResult),
                ...(happened ? { lastCallAt: at } : {}),
              },
            });
          }
        }
        if (m) {
          await db.campaignCompany.update({
            where: key,
            data: isCall
              ? {
                  attempts: { increment: 1 },
                  ...(connected ? { connects: { increment: 1 } } : {}),
                  // Whoever calls an unassigned company takes it
                  ...(m.assignedToId ? {} : { assignedToId: user.id }),
                  lastResult: input.callResult,
                  ...(forPeople ? {} : { status: memberStatusForCall(m.status, input.callResult) }),
                  ...(happened ? { lastCallAt: at } : {}),
                  // The call handled the due action; the follow-up (if any) sets the next one
                  nextActionAt: input.followUp ? new Date(input.followUp.dueAt) : null,
                }
              : { status: ["Disqualified", "Completed"].includes(m.status) ? m.status : "Meeting booked" },
          });
          if (forPeople && isCall) await syncCompaniesFromPeople(campaignId, [companyId]);
        }
      }
      const stage = isCall ? stageForCall(input.callResult) : input.type === "MEETING" ? STAGE.meeting : null;
      if (stage) await advanceJourney(companyId, stage, user.id, { source: isCall ? "call" : "meeting", campaignId, activityId: activity.id });
    }
    if (happened && (isCall || input.type === "EMAIL" || input.type === "MEETING")) {
      await db.company.updateMany({ where: { id: { in: companyIds } }, data: { lastContactedAt: at } });
      if (!isCall) await db.contact.updateMany({ where: { id: { in: contactIds } }, data: { lastContactedAt: at } });
    }

    if (input.followUp) {
      await db.activity.create({
        data: {
          ...activityFields({ type: "TASK", title: input.followUp.title, taskType: input.followUp.taskType, dueAt: input.followUp.dueAt }),
          taskStatus: "NOT_STARTED",
          ownerId: user.id,
          assigneeId: user.id,
          contacts: { create: contactIds.map((contactId) => ({ contactId })) },
          companies: { create: companyIds.map((companyId) => ({ companyId })) },
        },
      });
    }

    const automations = isCall && target ? await runActivityRules("CONTACT", target, { type: "CALL", callResult: input.callResult }, user.id) : [];
    revalidate(object, recordId);
    return { ok: true, data: { id: activity.id, automations } };
  } catch (e) {
    return fail(e);
  }
}

async function editableActivity(id: string, userId: string) {
  const a = await db.activity.findUniqueOrThrow({ where: { id } });
  if (a.type === "SYSTEM") throw new Error("System events can't be changed");
  if (a.ownerId !== userId && a.assigneeId !== userId && !["Admin", "Manager"].includes((await roleName(userId)) ?? "")) {
    throw new Error("Only the person who logged it, its assignee, managers or admins can change this");
  }
  return a;
}

export async function updateActivity(object: CrmObject, recordId: string, id: string, input: ActivityInput): Promise<Result> {
  try {
    const user = await requireUser();
    const a = await editableActivity(id, user.id);
    if (a.type !== input.type) throw new Error("Activity type can't change");
    const fields = activityFields(input);
    if (input.type === "CALL") {
      // The dialed number and target stay as logged; the CRT rollups were counted then
      delete fields.phoneNumberId;
      delete fields.dialedNumber;
      delete fields.targetContactId;
    }
    if (input.type === "TASK" && !fields.assigneeId) fields.assigneeId = a.assigneeId;
    await db.activity.update({ where: { id }, data: fields as Prisma.ActivityUncheckedUpdateInput });
    revalidate(object, recordId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Undo or redo a call's contribution to the CRT/connected counts (contact, companies, campaign membership). */
async function adjustCallCounts(a: { id: string; targetContactId: string | null; callResult: string | null; campaignId: string | null }, delta: 1 | -1) {
  const connected = /^connected/i.test(a.callResult ?? "");
  const bump = (n: number) => Math.max(0, n + delta);
  if (a.targetContactId) {
    const c = await db.contact.findUnique({ where: { id: a.targetContactId }, select: { crtCount: true, connectedCount: true } });
    if (c) await db.contact.update({ where: { id: a.targetContactId }, data: { crtCount: bump(c.crtCount), ...(connected ? { connectedCount: bump(c.connectedCount) } : {}) } });
  }
  const links = await db.activityCompany.findMany({ where: { activityId: a.id }, select: { company: { select: { id: true, crtCount: true, connectedCount: true } } } });
  for (const { company } of links) {
    await db.company.update({ where: { id: company.id }, data: { crtCount: bump(company.crtCount), ...(connected ? { connectedCount: bump(company.connectedCount) } : {}) } });
    if (a.campaignId) {
      const m = await db.campaignCompany.findUnique({ where: { campaignId_companyId: { campaignId: a.campaignId, companyId: company.id } } });
      if (m) await db.campaignCompany.update({ where: { campaignId_companyId: { campaignId: a.campaignId, companyId: company.id } }, data: { attempts: bump(m.attempts), ...(connected ? { connects: bump(m.connects) } : {}) } });
    }
  }
  // Contact campaigns count attempts per person too
  if (a.campaignId && a.targetContactId) {
    const key = { campaignId_contactId: { campaignId: a.campaignId, contactId: a.targetContactId } };
    const p = await db.campaignContact.findUnique({ where: key });
    if (p) await db.campaignContact.update({ where: key, data: { attempts: bump(p.attempts), ...(connected ? { connects: bump(p.connects) } : {}) } });
  }
}

export async function deleteActivity(object: CrmObject, recordId: string, id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const a = await editableActivity(id, user.id);
    await db.activity.update({ where: { id }, data: { deletedAt: new Date() } });
    if (a.type === "CALL") await adjustCallCounts(a, -1);
    await db.auditLog.create({ data: { objectType: object, recordId, action: "delete_activity", changes: json({ activityId: id, type: a.type }), userId: user.id } });
    revalidate(object, recordId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreActivity(object: CrmObject, recordId: string, id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const a = await editableActivity(id, user.id);
    await db.activity.update({ where: { id }, data: { deletedAt: null } });
    if (a.type === "CALL") await adjustCallCounts(a, 1);
    revalidate(object, recordId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setTaskDone(object: CrmObject, recordId: string, id: string, done: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    const a = await editableActivity(id, user.id);
    if (a.type !== "TASK") throw new Error("Not a task");
    await db.activity.update({ where: { id }, data: { taskStatus: done ? "COMPLETED" : "NOT_STARTED", completedAt: done ? new Date() : null } });
    revalidate(object, recordId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Personal record-page state ──

async function setUi(userId: string, key: string, value: unknown) {
  if (value === undefined) {
    await db.userUiState.deleteMany({ where: { userId, key } });
    return;
  }
  await db.userUiState.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value: json(value) }, update: { value: json(value) } });
}

export async function setCardCollapsed(object: CrmObject, cardId: string, collapsed: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    const key = collapsedKey(object);
    const row = await db.userUiState.findUnique({ where: { userId_key: { userId: user.id, key } } });
    const list = ((row?.value as string[] | null) ?? []).filter((c) => c !== cardId);
    await setUi(user.id, key, collapsed ? [...list, cardId] : list);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Personal choice of "Key information" properties; null resets to the layout's list. */
export async function setKeyInfo(object: CrmObject, properties: string[] | null): Promise<Result> {
  try {
    const user = await requireUser();
    await setUi(user.id, keyInfoKey(object), properties ?? undefined);
    revalidate(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setFollow(object: CrmObject, id: string, follow: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    await setUi(user.id, followKey(object, id), follow ? true : undefined);
    revalidate(object, id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Record actions ──

export async function deleteRecord(object: CrmObject, id: string): Promise<Result> {
  const res = await bulkDelete(object, [id]);
  return res.ok ? { ok: true } : res;
}

export async function cloneRecord(object: CrmObject, id: string): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const system = { activities: { create: { activity: { create: { type: "SYSTEM" as const, ownerId: user.id, systemData: json({ kind: "created", source: "Clone" }) } } } } };
    if (object === "CONTACT") {
      const c = await db.contact.findUniqueOrThrow({ where: { id }, include: { companies: true } });
      // Email is unique per contact and rollups belong to the original, so neither is copied
      const copy = await db.contact.create({
        data: {
          firstName: c.firstName,
          lastName: `${c.lastName ?? ""} (copy)`.trim(),
          jobTitle: c.jobTitle,
          seniority: c.seniority,
          department: c.department,
          city: c.city,
          country: c.country,
          timeZone: c.timeZone,
          ownerId: c.ownerId,
          lifecycleStage: c.lifecycleStage,
          leadStatus: "New",
          leadState: c.leadState,
          campaign: c.campaign,
          callable: c.callable,
          callStatus: "Never Reached Targets",
          properties: json(c.properties),
          createdById: user.id,
          companies: { create: c.companies.map((l) => ({ companyId: l.companyId, isPrimary: l.isPrimary, labels: l.labels })) },
          ...system,
        },
      });
      await db.auditLog.create({ data: { objectType: object, recordId: copy.id, action: "create", changes: json({ clonedFrom: id }), userId: user.id } });
      revalidate(object);
      return { ok: true, data: { id: copy.id } };
    }
    const co = await db.company.findUniqueOrThrow({ where: { id } });
    // Domain is unique and activity dates belong to the original, so neither is copied
    const copy = await db.company.create({
      data: {
        name: `${co.name} (copy)`,
        linkedinUrl: co.linkedinUrl,
        phone: co.phone,
        country: co.country,
        state: co.state,
        city: co.city,
        timeZone: co.timeZone,
        industry: co.industry,
        employees: co.employees,
        foundedYear: co.foundedYear,
        annualRevenue: co.annualRevenue ?? undefined,
        offerType: co.offerType,
        technologies: co.technologies,
        description: co.description,
        servicesOrApps: co.servicesOrApps,
        listSource: co.listSource,
        source: co.source,
        campaign: co.campaign,
        tags: co.tags,
        ownerId: co.ownerId,
        lifecycleStage: co.lifecycleStage,
        leadStatus: "New",
        leadState: co.leadState,
        properties: json(co.properties),
        createdById: user.id,
        ...system,
      },
    });
    await db.auditLog.create({ data: { objectType: object, recordId: copy.id, action: "create", changes: json({ clonedFrom: id }), userId: user.id } });
    revalidate(object);
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function getRecordHistory(object: CrmObject, id: string) {
  await requireUser();
  const rows = await db.auditLog.findMany({
    where: { objectType: object, recordId: id },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return rows.map((r) => ({ id: r.id, action: r.action, changes: r.changes as Record<string, unknown> | null, at: r.createdAt.toISOString(), user: r.user?.name ?? r.user?.email ?? "System" }));
}

export type HistoryRow = Awaited<ReturnType<typeof getRecordHistory>>[number];

// ── Associations (contact ↔ company) ──

async function touchAssociation(contactId: string, companyId: string, userId: string, change: Record<string, unknown>) {
  await db.auditLog.createMany({
    data: [
      { objectType: "CONTACT", recordId: contactId, action: "association", changes: json({ companyId, ...change }), userId },
      { objectType: "COMPANY", recordId: companyId, action: "association", changes: json({ contactId, ...change }), userId },
    ],
  });
  revalidate("CONTACT", contactId);
  revalidate("COMPANY", companyId);
}

export async function associate(contactId: string, companyId: string): Promise<Result> {
  try {
    const user = await requireUser();
    const [contact, company] = await Promise.all([db.contact.findFirst({ where: { id: contactId, deletedAt: null } }), db.company.findFirst({ where: { id: companyId, deletedAt: null } })]);
    if (!contact || !company) throw new Error("Record not found");
    const hasPrimary = await db.contactCompany.count({ where: { contactId, isPrimary: true } });
    await db.contactCompany.upsert({ where: { contactId_companyId: { contactId, companyId } }, create: { contactId, companyId, isPrimary: !hasPrimary }, update: {} });
    await touchAssociation(contactId, companyId, user.id, { added: true });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function dissociate(contactId: string, companyId: string): Promise<Result> {
  try {
    const user = await requireUser();
    const link = await db.contactCompany.findUnique({ where: { contactId_companyId: { contactId, companyId } } });
    if (!link) return { ok: true };
    await db.contactCompany.delete({ where: { contactId_companyId: { contactId, companyId } } });
    // Keep a primary company when one remains
    if (link.isPrimary) {
      const next = await db.contactCompany.findFirst({ where: { contactId }, orderBy: { createdAt: "asc" } });
      if (next) await db.contactCompany.update({ where: { contactId_companyId: { contactId, companyId: next.companyId } }, data: { isPrimary: true } });
    }
    await touchAssociation(contactId, companyId, user.id, { removed: true });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setPrimaryCompany(contactId: string, companyId: string): Promise<Result> {
  try {
    const user = await requireUser();
    await db.$transaction([
      db.contactCompany.updateMany({ where: { contactId }, data: { isPrimary: false } }),
      db.contactCompany.update({ where: { contactId_companyId: { contactId, companyId } }, data: { isPrimary: true } }),
    ]);
    await touchAssociation(contactId, companyId, user.id, { primary: true });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function setAssociationLabels(contactId: string, companyId: string, labels: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    const allowed = new Set((await db.associationLabel.findMany({ where: { fromObject: "CONTACT", toObject: "COMPANY" }, select: { label: true } })).map((l) => l.label));
    const clean = [...new Set(labels)].filter((l) => allowed.has(l) && l !== "Primary");
    await db.contactCompany.update({ where: { contactId_companyId: { contactId, companyId } }, data: { labels: clean } });
    await touchAssociation(contactId, companyId, user.id, { labels: clean });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function searchContacts(q: string) {
  await requireUser();
  const s = q.trim();
  const rows = await db.contact.findMany({
    where: {
      deletedAt: null,
      ...(s ? { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { lastName: { contains: s, mode: "insensitive" } }, { email: { contains: s, mode: "insensitive" } }] } : {}),
    },
    select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true },
    orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
    take: 10,
  });
  return rows.map((r) => ({ id: r.id, name: fullName(r), subtitle: r.jobTitle ?? r.email }));
}
