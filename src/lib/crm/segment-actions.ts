"use server";

import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { loadQueryContext } from "./context";
import { OBJECT_LABELS } from "./defaults";
import { searchWhere } from "./query";
import { canEditSegment, segmentRecordsWhere } from "./segments";
import type { CrmObject, FilterCondition, FilterGroup, SegmentExclusions, ViewState } from "./types";
import { isActiveCondition } from "./view-state";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;

function revalidate(object?: CrmObject) {
  revalidatePath("/segments", "layout");
  if (object) revalidatePath(OBJECT_LABELS[object].path, "layout");
}

async function editableSegment(id: string, userId: string) {
  const s = await db.segment.findUniqueOrThrow({ where: { id } });
  if (!(await canEditSegment(s, userId))) throw new Error("Only the owner, managers or admins can change this segment");
  return s;
}

function cleanName(name: string) {
  const n = name.trim();
  if (!n) throw new Error("Name the segment");
  if (n.length > 100) throw new Error("Keep the name under 100 characters");
  return n;
}

/** "Me" in a segment means its creator, not whoever is looking at it later. */
function pinUser(c: FilterCondition, userId: string): FilterCondition {
  return Array.isArray(c.value) ? { ...c, value: c.value.map((v) => (v === "__me__" ? userId : v)) } : c;
}

function cleanGroups(groups: FilterGroup[], userId: string): FilterGroup[] {
  return groups
    .map((g) => ({ op: g.op === "OR" ? ("OR" as const) : ("AND" as const), conditions: g.conditions.filter(isActiveCondition).map((c) => pinUser(c, userId)) }))
    .filter((g) => g.conditions.length);
}

async function memberRows(object: CrmObject, segmentId: string, ids: string[], userId: string) {
  const existing =
    object === "CONTACT"
      ? await db.contact.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } })
      : await db.company.findMany({ where: { id: { in: ids }, deletedAt: null }, select: { id: true } });
  return existing.map(({ id }) => ({
    segmentId,
    recordId: id,
    addedById: userId,
    ...(object === "CONTACT" ? { contactId: id } : { companyId: id }),
  }));
}

export async function createSegment(object: CrmObject, name: string, type: "ACTIVE" | "STATIC", groups: FilterGroup[] = [], ids: string[] = []): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    if (object === "DEAL") throw new Error("Deal segments arrive with deals");
    const s = await db.segment.create({
      data: { name: cleanName(name), objectType: object, type, ownerId: user.id, filters: type === "ACTIVE" ? json(cleanGroups(groups, user.id)) : undefined },
    });
    if (type === "STATIC" && ids.length) await db.segmentMember.createMany({ data: await memberRows(object, s.id, ids, user.id), skipDuplicates: true });
    await db.auditLog.create({ data: { action: "settings", changes: json({ createdSegment: { id: s.id, name: s.name, type } }), userId: user.id } });
    revalidate(object);
    return { ok: true, data: { id: s.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Active segment from an index view: its quick filters and owner tab apply to every advanced group. */
export async function createSegmentFromView(object: CrmObject, name: string, systemKey: string | null, state: ViewState): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const base = Object.values(state.quick).filter(isActiveCondition);
    if (systemKey === "mine") base.push({ property: "ownerId", operator: "is_any_of", value: [user.id] });
    if (systemKey === "unassigned") base.push({ property: "ownerId", operator: "is_any_of", value: ["__none__"] });
    // The shared conditions apply to every group. An OR group (a or b) becomes one AND group per condition,
    // since base AND (a OR b) = (base AND a) OR (base AND b)
    const groups: FilterGroup[] = state.advanced.length
      ? state.advanced.flatMap((g): FilterGroup[] =>
          g.op === "OR" && base.length ? g.conditions.map((c) => ({ op: "AND", conditions: [c, ...base] })) : [{ op: g.op, conditions: [...g.conditions, ...base] }],
        )
      : [{ op: "AND", conditions: base }];
    if (!groups.some((g) => g.conditions.length)) throw new Error("Add a filter first. A segment of every record isn't useful");
    return createSegment(object, name, "ACTIVE", groups);
  } catch (e) {
    return fail(e);
  }
}

export async function updateSegment(
  id: string,
  patch: { name?: string; groups?: FilterGroup[]; visibility?: "PRIVATE" | "TEAM" | "EVERYONE"; description?: string | null; exclusions?: SegmentExclusions },
): Promise<Result> {
  try {
    const user = await requireUser();
    const s = await editableSegment(id, user.id);
    if (patch.groups && s.type !== "ACTIVE") throw new Error("Static segments don't have filters");
    const groups = patch.groups ? cleanGroups(patch.groups, user.id) : undefined;
    if (groups && !groups.length) throw new Error("An active segment needs at least one filter");
    let exclusions: SegmentExclusions | undefined;
    if (patch.exclusions) {
      exclusions = { segments: [...new Set(patch.exclusions.segments.map(String))].filter((x) => x !== id), records: [...new Set(patch.exclusions.records.map(String))] };
      if (exclusions.segments.length > 10) throw new Error("Exclude up to 10 segments");
      const others = await db.segment.count({ where: { id: { in: exclusions.segments }, objectType: s.objectType } });
      if (others !== exclusions.segments.length) throw new Error("Excluded segments must be of the same object");
    }
    await db.segment.update({
      where: { id },
      data: {
        ...(patch.name !== undefined ? { name: cleanName(patch.name) } : {}),
        ...(patch.visibility ? { visibility: patch.visibility } : {}),
        ...(groups ? { filters: json(groups) } : {}),
        ...(patch.description !== undefined ? { description: patch.description?.trim().slice(0, 500) || null } : {}),
        ...(exclusions ? { exclusions: json(exclusions) } : {}),
      },
    });
    await db.auditLog.create({ data: { action: "settings", changes: json({ updatedSegment: { id, ...patch } }), userId: user.id } });
    revalidate(s.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cloneSegment(id: string): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const s = await db.segment.findUniqueOrThrow({ where: { id }, include: { members: { select: { recordId: true } } } });
    const copy = await db.segment.create({
      data: { name: `${s.name} (copy)`.slice(0, 100), objectType: s.objectType, type: s.type, filters: s.filters ?? undefined, exclusions: s.exclusions ?? undefined, description: s.description, ownerId: user.id },
    });
    if (s.type === "STATIC" && s.members.length) {
      await db.segmentMember.createMany({ data: await memberRows(s.objectType as CrmObject, copy.id, s.members.map((m) => m.recordId), user.id) });
    }
    revalidate(s.objectType as CrmObject);
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteSegment(id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const s = await editableSegment(id, user.id);
    await db.segment.delete({ where: { id } });
    await db.auditLog.create({ data: { action: "settings", changes: json({ deletedSegment: { id, name: s.name, type: s.type } }), userId: user.id } });
    revalidate(s.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Freeze an active segment's current matches into a static list. */
export async function convertToStatic(id: string): Promise<Result<{ members: number }>> {
  try {
    const user = await requireUser();
    const s = await editableSegment(id, user.id);
    if (s.type === "STATIC") return { ok: true, data: { members: 0 } };
    const object = s.objectType as CrmObject;
    const where = segmentRecordsWhere(object, id, await loadQueryContext(user.id));
    const ids = (
      object === "CONTACT"
        ? await db.contact.findMany({ where: where as Prisma.ContactWhereInput, select: { id: true } })
        : await db.company.findMany({ where: where as Prisma.CompanyWhereInput, select: { id: true } })
    ).map((r) => r.id);
    const rows = await memberRows(object, id, ids, user.id);
    await db.$transaction([db.segmentMember.createMany({ data: rows, skipDuplicates: true }), db.segment.update({ where: { id }, data: { type: "STATIC", filters: json(null) } })]);
    revalidate(object);
    return { ok: true, data: { members: rows.length } };
  } catch (e) {
    return fail(e);
  }
}

/** Adds records to a static segment; `addedIds` excludes records that were already members (so undo leaves those). */
export async function addToSegment(segmentId: string, ids: string[]): Promise<Result<{ added: number; addedIds: string[] }>> {
  try {
    const user = await requireUser();
    const s = await editableSegment(segmentId, user.id);
    if (s.type !== "STATIC") throw new Error("Records join active segments through its filters. Pick a static segment");
    const existing = new Set((await db.segmentMember.findMany({ where: { segmentId, recordId: { in: ids } }, select: { recordId: true } })).map((m) => m.recordId));
    const rows = (await memberRows(s.objectType as CrmObject, segmentId, ids, user.id)).filter((r) => !existing.has(r.recordId));
    await db.segmentMember.createMany({ data: rows, skipDuplicates: true });
    await db.segment.update({ where: { id: segmentId }, data: { updatedAt: new Date() } });
    revalidate(s.objectType as CrmObject);
    return { ok: true, data: { added: rows.length, addedIds: rows.map((r) => r.recordId) } };
  } catch (e) {
    return fail(e);
  }
}

/** Record search for "Add records" on a static segment, flagging records already in it. */
export async function searchSegmentCandidates(segmentId: string, q: string) {
  await requireUser();
  const s = await db.segment.findUniqueOrThrow({ where: { id: segmentId }, select: { objectType: true } });
  const object = s.objectType as CrmObject;
  const where = { AND: [{ deletedAt: null }, searchWhere(object, q) ?? {}] };
  const rows =
    object === "CONTACT"
      ? (
          await db.contact.findMany({
            where: where as Prisma.ContactWhereInput,
            select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true },
            orderBy: [{ firstName: "asc" }, { lastName: "asc" }],
            take: 15,
          })
        ).map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(No name)", subtitle: c.jobTitle ?? c.email }))
      : (
          await db.company.findMany({ where: where as Prisma.CompanyWhereInput, select: { id: true, name: true, domain: true }, orderBy: { name: "asc" }, take: 15 })
        ).map((c) => ({ id: c.id, name: c.name, subtitle: c.domain }));
  const members = new Set((await db.segmentMember.findMany({ where: { segmentId, recordId: { in: rows.map((r) => r.id) } }, select: { recordId: true } })).map((m) => m.recordId));
  return rows.map((r) => ({ ...r, isMember: members.has(r.id) }));
}

export async function removeFromSegment(segmentId: string, ids: string[]): Promise<Result<{ removed: number }>> {
  try {
    const user = await requireUser();
    const s = await editableSegment(segmentId, user.id);
    if (s.type !== "STATIC") throw new Error("Change the filters to remove records from an active segment");
    const res = await db.segmentMember.deleteMany({ where: { segmentId, recordId: { in: ids } } });
    await db.segment.update({ where: { id: segmentId }, data: { updatedAt: new Date() } });
    revalidate(s.objectType as CrmObject);
    return { ok: true, data: { removed: res.count } };
  } catch (e) {
    return fail(e);
  }
}
