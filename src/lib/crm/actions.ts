"use server";

import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { OBJECT_LABELS } from "./defaults";
import { normalizeCountry, normalizeRegion, timeZoneFor } from "./geo";
import { PAGE_SIZES, viewPrefsKey, visibleViews, type ViewTabPrefs } from "./index-loader";
import { applyUpdate } from "./record-writes";
import type { CrmObject, PropOption, PropType, ViewState } from "./types";

const MAX_VIEWS_PER_USER = 50;

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };

function fail(e: unknown): { ok: false; error: string } {
  return { ok: false, error: e instanceof Error ? e.message : "Something went wrong" };
}

function revalidate(object: CrmObject) {
  revalidatePath(OBJECT_LABELS[object].path, "layout");
}

const json = (v: unknown) => v as Prisma.InputJsonValue;

// ── Record property updates ──

export async function updateProperty(object: CrmObject, id: string, property: string, value: unknown): Promise<Result> {
  try {
    const user = await requireUser();
    await applyUpdate(object, id, property, value, user.id);
    revalidate(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function bulkUpdate(object: CrmObject, ids: string[], property: string, value: unknown): Promise<Result<{ updated: number }>> {
  try {
    const user = await requireUser();
    for (const id of ids) await applyUpdate(object, id, property, value, user.id);
    revalidate(object);
    return { ok: true, data: { updated: ids.length } };
  } catch (e) {
    return fail(e);
  }
}

export async function bulkDelete(object: CrmObject, ids: string[]): Promise<Result<{ deleted: number }>> {
  try {
    const user = await requireUser();
    const role = await db.user.findUnique({ where: { id: user.id }, include: { role: true } });
    const perms = (role?.role?.permissions ?? {}) as { contacts?: { delete?: boolean } };
    if (perms.contacts?.delete === false) throw new Error("Your role can't delete records");
    const now = new Date();
    const res =
      object === "CONTACT"
        ? await db.contact.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } })
        : await db.company.updateMany({ where: { id: { in: ids } }, data: { deletedAt: now } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: object, recordId, action: "delete", userId: user.id })) });
    revalidate(object);
    return { ok: true, data: { deleted: res.count } };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreRecords(object: CrmObject, ids: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    if (object === "CONTACT") await db.contact.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
    else await db.company.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: object, recordId, action: "restore", userId: user.id })) });
    revalidate(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Create records ──

/** Country, state/province and the time zone they imply */
function location(country?: string, state?: string) {
  const c = country?.trim() ? normalizeCountry(country) : null;
  const s = state?.trim() ? normalizeRegion(c, state) : null;
  return { country: c, state: s, timeZone: timeZoneFor(c, s) };
}

export async function createContact(input: {
  firstName?: string;
  lastName?: string;
  email?: string;
  jobTitle?: string;
  phone?: string;
  companyId?: string;
  ownerId?: string;
  lifecycleStage?: string;
  leadStatus?: string;
}): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!input.firstName && !input.lastName && !input.email) throw new Error("Enter a name or email");
    const email = input.email?.trim().toLowerCase() || null;
    if (email) {
      const dupe = await db.contact.findFirst({ where: { email, deletedAt: null }, select: { id: true } });
      if (dupe) throw new Error("A contact with this email already exists");
    }
    const c = await db.contact.create({
      data: {
        firstName: input.firstName?.trim() || null,
        lastName: input.lastName?.trim() || null,
        email,
        jobTitle: input.jobTitle?.trim() || null,
        phone: input.phone?.trim() || null,
        ownerId: input.ownerId || null,
        lifecycleStage: input.lifecycleStage || "Lead",
        leadStatus: input.leadStatus || "New",
        callStatus: "Never Reached Targets",
        createdById: user.id,
        companies: input.companyId ? { create: { companyId: input.companyId, isPrimary: true } } : undefined,
        activities: { create: { activity: { create: { type: "SYSTEM", ownerId: user.id, systemData: { kind: "created", source: "Manual" } } } } },
      },
    });
    await db.auditLog.create({ data: { objectType: "CONTACT", recordId: c.id, action: "create", userId: user.id } });
    revalidate("CONTACT");
    return { ok: true, data: { id: c.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function createCompany(input: { name: string; domain?: string; industry?: string; city?: string; country?: string; state?: string; ownerId?: string; phone?: string }): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!input.name?.trim()) throw new Error("Company name is required");
    const domain =
      input.domain
        ?.trim()
        .toLowerCase()
        .replace(/^https?:\/\//, "")
        .replace(/^www\./, "")
        .replace(/\/.*$/, "") || null;
    if (domain) {
      const dupe = await db.company.findUnique({ where: { domain }, select: { id: true, deletedAt: true } });
      if (dupe) throw new Error(dupe.deletedAt ? "A deleted company has this domain — restore it instead" : "A company with this domain already exists");
    }
    const c = await db.company.create({
      data: {
        name: input.name.trim(),
        domain,
        industry: input.industry || null,
        city: input.city?.trim() || null,
        ...location(input.country, input.state),
        phone: input.phone?.trim() || null,
        ownerId: input.ownerId || null,
        lifecycleStage: "Lead",
        leadStatus: "New",
        createdById: user.id,
        activities: { create: { activity: { create: { type: "SYSTEM", ownerId: user.id, systemData: { kind: "created", source: "Manual" } } } } },
      },
    });
    await db.auditLog.create({ data: { objectType: "COMPANY", recordId: c.id, action: "create", userId: user.id } });
    revalidate("COMPANY");
    return { ok: true, data: { id: c.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function searchCompanies(q: string) {
  await requireUser();
  return db.company.findMany({
    where: { deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] } : {}) },
    select: { id: true, name: true, domain: true },
    orderBy: { name: "asc" },
    take: 10,
  });
}

// ── Saved views ──

async function ownedView(viewId: string, userId: string) {
  const v = await db.savedView.findUniqueOrThrow({ where: { id: viewId } });
  if (v.systemKey) {
    const u = await db.user.findUnique({ where: { id: userId }, include: { role: true } });
    if (u?.role?.name !== "Admin") throw new Error("Only admins can change the default views");
  } else if (v.ownerId !== userId) {
    throw new Error("You can only change views you created");
  }
  return v;
}

function stateToColumns(state: ViewState) {
  return {
    filters: json({ quick: state.quick, advanced: state.advanced }),
    quickFilters: json(state.chips),
    columns: json(state.columns),
    sort: json(state.sort ? [state.sort] : []),
  };
}

type Visibility = "PRIVATE" | "TEAM" | "EVERYONE";

/** TEAM views need a team the user belongs to (admins may pick any team). */
async function resolveTeam(userId: string, visibility: Visibility, teamId?: string | null) {
  if (visibility !== "TEAM") return null;
  const u = await db.user.findUnique({ where: { id: userId }, include: { role: true, teams: true } });
  if (teamId) {
    if (u?.role?.name !== "Admin" && !u?.teams.some((t) => t.teamId === teamId)) throw new Error("You can only share with your own teams");
    return teamId;
  }
  const first = u?.teams[0]?.teamId;
  if (!first) throw new Error("You aren't on a team yet. Share with everyone or keep it private");
  return first;
}

async function readPrefs(userId: string, object: CrmObject) {
  const row = await db.userUiState.findUnique({ where: { userId_key: { userId, key: viewPrefsKey(object) } } });
  return (row?.value ?? {}) as ViewTabPrefs;
}

async function writePrefs(userId: string, object: CrmObject, prefs: ViewTabPrefs) {
  const key = viewPrefsKey(object);
  await db.userUiState.upsert({ where: { userId_key: { userId, key } }, create: { userId, key, value: json(prefs) }, update: { value: json(prefs) } });
}

/** The ids currently open as tabs, materialising the "everything open" default on first change. */
async function openIds(userId: string, object: CrmObject, prefs: ViewTabPrefs) {
  if (prefs.open) return prefs.open;
  return (await visibleViews(object, userId)).filter((v) => !v.systemKey).map((v) => v.id);
}

export async function createView(
  object: CrmObject,
  name: string,
  visibility: Visibility,
  state: ViewState,
  opts: { teamId?: string | null; pageSize?: number } = {},
): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!name.trim()) throw new Error("Name the view");
    const count = await db.savedView.count({ where: { ownerId: user.id } });
    if (count >= MAX_VIEWS_PER_USER) throw new Error(`You can have up to ${MAX_VIEWS_PER_USER} views`);
    const max = await db.savedView.aggregate({ where: { objectType: object }, _max: { order: true } });
    const teamId = await resolveTeam(user.id, visibility, opts.teamId);
    const v = await db.savedView.create({
      data: {
        objectType: object,
        name: name.trim(),
        visibility,
        teamId,
        ownerId: user.id,
        order: (max._max.order ?? 0) + 1,
        ...(opts.pageSize && PAGE_SIZES.includes(opts.pageSize) ? { pageSize: opts.pageSize } : {}),
        ...stateToColumns(state),
      },
    });
    const prefs = await readPrefs(user.id, object);
    if (prefs.open) await writePrefs(user.id, object, { ...prefs, open: [...prefs.open, v.id] });
    revalidate(object);
    return { ok: true, data: { id: v.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function saveView(viewId: string, state: ViewState, pageSize?: number): Promise<Result> {
  try {
    const user = await requireUser();
    const v = await ownedView(viewId, user.id);
    await db.savedView.update({
      where: { id: viewId },
      data: { ...stateToColumns(state), ...(pageSize && PAGE_SIZES.includes(pageSize) ? { pageSize } : {}) },
    });
    revalidate(v.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function renameView(viewId: string, name: string, visibility?: Visibility, teamId?: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    if (!name.trim()) throw new Error("Name the view");
    const v = await ownedView(viewId, user.id);
    const sharing = visibility && !v.systemKey ? { visibility, teamId: await resolveTeam(user.id, visibility, teamId), ...(visibility === "PRIVATE" ? { isPinned: false } : {}) } : {};
    await db.savedView.update({ where: { id: viewId }, data: { name: name.trim(), ...sharing } });
    revalidate(v.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cloneView(viewId: string, state: ViewState): Promise<Result<{ id: string }>> {
  try {
    await requireUser();
    const v = await db.savedView.findUniqueOrThrow({ where: { id: viewId } });
    return createView(v.objectType as CrmObject, `${v.name} (copy)`, "PRIVATE", state, { pageSize: v.pageSize });
  } catch (e) {
    return fail(e);
  }
}

/** Show a view as a tab ("All views" → open) or hide it again. System and pinned views always stay. */
export async function setViewOpen(object: CrmObject, viewId: string, open: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    const prefs = await readPrefs(user.id, object);
    const ids = (await openIds(user.id, object, prefs)).filter((id) => id !== viewId);
    await writePrefs(user.id, object, { ...prefs, open: open ? [...ids, viewId] : ids });
    revalidate(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The view this user lands on when opening the object (null = "All"). */
export async function setDefaultView(object: CrmObject, viewId: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    const prefs = await readPrefs(user.id, object);
    const ids = await openIds(user.id, object, prefs);
    await writePrefs(user.id, object, { ...prefs, default: viewId ?? undefined, open: viewId && !ids.includes(viewId) ? [...ids, viewId] : ids });
    revalidate(object);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Admins pin shared views so they show as a tab for everyone (or every team member) who can see them. */
export async function pinView(viewId: string, pinned: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    const u = await db.user.findUnique({ where: { id: user.id }, include: { role: true } });
    if (u?.role?.name !== "Admin") throw new Error("Only admins can pin views");
    const v = await db.savedView.findUniqueOrThrow({ where: { id: viewId } });
    if (v.systemKey) throw new Error("Default views are always shown");
    if (pinned && v.visibility === "PRIVATE") throw new Error("Share the view with a team or everyone before pinning it");
    await db.savedView.update({ where: { id: viewId }, data: { isPinned: pinned } });
    revalidate(v.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteView(viewId: string): Promise<Result> {
  try {
    const user = await requireUser();
    const v = await ownedView(viewId, user.id);
    if (v.systemKey) throw new Error("Default views can't be deleted");
    await db.savedView.delete({ where: { id: viewId } });
    revalidate(v.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function moveView(viewId: string, direction: -1 | 1): Promise<Result> {
  try {
    const user = await requireUser();
    const v = await ownedView(viewId, user.id);
    if (v.systemKey) throw new Error("Default views stay first");
    const all = await db.savedView.findMany({ where: { objectType: v.objectType, systemKey: null }, orderBy: [{ order: "asc" }, { createdAt: "asc" }] });
    const i = all.findIndex((x) => x.id === viewId);
    const j = i + direction;
    if (j < 0 || j >= all.length) return { ok: true };
    [all[i], all[j]] = [all[j], all[i]];
    await db.$transaction(all.map((x, k) => db.savedView.update({ where: { id: x.id }, data: { order: 3 + k } })));
    revalidate(v.objectType as CrmObject);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Custom properties ──

export async function createProperty(
  object: CrmObject,
  input: { label: string; type: PropType; group: string; options?: string[]; description?: string },
): Promise<Result<{ name: string }>> {
  try {
    const user = await requireUser();
    const u = await db.user.findUnique({ where: { id: user.id }, include: { role: true } });
    if (u?.role?.name !== "Admin" && u?.role?.name !== "Manager") throw new Error("Only admins and managers can create properties");
    const label = input.label.trim();
    if (!label) throw new Error("Enter a label");
    const base = label
      .replace(/[^a-zA-Z0-9 ]/g, "")
      .split(/\s+/)
      .filter(Boolean)
      .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
      .join("");
    if (!base) throw new Error("Label needs letters or numbers");
    let name = base;
    for (let n = 2; await db.propertyDefinition.findUnique({ where: { objectType_name: { objectType: object, name } } }); n++) name = `${base}${n}`;

    const group = await db.propertyGroup.findUnique({ where: { objectType_name: { objectType: object, name: input.group } } });
    const needsOptions = ["ENUM", "MULTI_ENUM", "RADIO"].includes(input.type);
    const options: PropOption[] | undefined = needsOptions
      ? (input.options ?? [])
          .map((o) => o.trim())
          .filter(Boolean)
          .map((value, order) => ({ value, label: value, order }))
      : undefined;
    if (needsOptions && !options?.length) throw new Error("Add at least one option");

    const max = await db.propertyDefinition.aggregate({ where: { objectType: object, groupId: group?.id }, _max: { order: true } });
    await db.propertyDefinition.create({
      data: {
        objectType: object,
        name,
        label,
        type: input.type,
        description: input.description?.trim() || null,
        groupId: group?.id,
        order: (max._max.order ?? 0) + 1,
        isBuiltIn: false,
        options: options ? json(options) : undefined,
      },
    });
    await db.auditLog.create({ data: { action: "settings", changes: json({ createdProperty: { object, name, label, type: input.type } }), userId: user.id } });
    revalidate(object);
    return { ok: true, data: { name } };
  } catch (e) {
    return fail(e);
  }
}

// ── Row expansion & preview ──

export async function getRecordPreview(object: CrmObject, id: string) {
  await requireUser();
  const activityWhere = object === "CONTACT" ? { contacts: { some: { contactId: id } } } : { companies: { some: { companyId: id } } };
  const activities = await db.activity.findMany({
    where: { ...activityWhere, deletedAt: null },
    orderBy: { occurredAt: "desc" },
    take: 6,
    select: { id: true, type: true, title: true, body: true, occurredAt: true, callResult: true, callPath: true, dialedNumber: true, dueAt: true, systemData: true, owner: { select: { name: true } } },
  });
  if (object === "CONTACT") {
    const [companies, phones] = await Promise.all([
      db.contactCompany.findMany({ where: { contactId: id }, include: { company: { select: { id: true, name: true, domain: true, phone: true } } }, orderBy: { isPrimary: "desc" } }),
      db.phoneNumber.findMany({ where: { contactId: id }, select: { id: true, number: true, type: true, ivrPath: true, status: true } }),
    ]);
    return {
      activities,
      companies: companies.map((c) => ({ ...c.company, isPrimary: c.isPrimary, labels: c.labels })),
      contacts: [],
      phones,
    };
  }
  const [contacts, phones] = await Promise.all([
    db.contactCompany.findMany({
      where: { companyId: id, contact: { deletedAt: null } },
      include: { contact: { select: { id: true, firstName: true, lastName: true, jobTitle: true, email: true, inDbnd: true, crtCount: true } } },
      take: 25,
    }),
    db.phoneNumber.findMany({ where: { companyId: id }, select: { id: true, number: true, type: true, ivrPath: true, status: true } }),
  ]);
  return { activities, companies: [], contacts: contacts.map((c) => ({ ...c.contact, labels: c.labels })), phones };
}

export type RecordPreview = Awaited<ReturnType<typeof getRecordPreview>>;
