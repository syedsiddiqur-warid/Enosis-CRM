"use server";

import type { CampaignStatus, Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { canEditCampaign } from "./campaign-loader";
import { DEFAULT_SETTINGS, MEMBER_STATUSES, addMembers, addPeople, criteriaWhere, parseSettings, syncCampaign, syncCompaniesFromPeople, type CampaignGoals, type CampaignSettings } from "./campaigns";
import { loadQueryContext } from "./context";
import { JOURNEY_PROPERTY, STAGE } from "./journey";
import { applyUpdate, advanceJourney } from "./record-writes";
import { segmentRecordsWhere } from "./segments";
import type { FilterGroup } from "./types";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;
const STATUSES: CampaignStatus[] = ["DRAFT", "ACTIVE", "PAUSED", "COMPLETED", "ARCHIVED"];

function revalidate(id?: string) {
  revalidatePath("/campaigns");
  if (id) revalidatePath(`/campaigns/${id}`);
  revalidatePath("/companies", "layout");
}

async function editable(id: string, userId: string) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id } });
  if (!(await canEditCampaign(c, userId))) throw new Error("Only the campaign owner, managers or admins can change this campaign");
  return c;
}

const date = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid date");
  return d;
};

function cleanName(name: string) {
  const n = name.trim();
  if (!n) throw new Error("Give the campaign a name");
  if (n.length > 120) throw new Error("Keep the name under 120 characters");
  return n;
}

export interface CampaignInput {
  name: string;
  type: string;
  description?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  /** COMPANY: everyone at each company / CONTACT: only the chosen people */
  audience?: "COMPANY" | "CONTACT";
  /** Start from a segment or a hand-picked selection */
  segmentId?: string | null;
  companyIds?: string[];
  contactIds?: string[];
  criteria?: FilterGroup[];
}

export async function createCampaign(input: CampaignInput): Promise<Result<{ id: string; added: number }>> {
  try {
    const user = await requireUser();
    const startDate = date(input.startDate);
    const endDate = date(input.endDate);
    if (startDate && endDate && endDate < startDate) throw new Error("The campaign ends before it starts");
    const c = await db.campaign.create({
      data: {
        name: cleanName(input.name),
        type: input.type || "Custom set",
        audience: input.audience === "CONTACT" ? "CONTACT" : "COMPANY",
        description: input.description?.trim() || null,
        startDate,
        endDate,
        ownerId: user.id,
        criteria: json(input.criteria ?? []),
        settings: json(DEFAULT_SETTINGS),
      },
    });
    let added = 0;
    if (c.audience === "CONTACT") {
      if (input.contactIds?.length) added += (await addPeople(c.id, input.contactIds, "manual", user.id)).people;
    } else if (input.companyIds?.length) added += (await addMembers(c.id, input.companyIds, "manual", user.id)).length;
    if (input.segmentId) added += (await addSegmentMembers(c.id, input.segmentId, user.id)).added;
    await db.auditLog.create({ data: { action: "create_campaign", changes: json({ campaignId: c.id, name: c.name }), userId: user.id } });
    revalidate(c.id);
    return { ok: true, data: { id: c.id, added } };
  } catch (e) {
    return fail(e);
  }
}

export interface CampaignPatch {
  name?: string;
  type?: string;
  description?: string | null;
  status?: CampaignStatus;
  ownerId?: string | null;
  startDate?: string | null;
  endDate?: string | null;
  pitch?: string | null;
  goals?: CampaignGoals;
  settings?: Partial<CampaignSettings>;
  criteria?: FilterGroup[];
}

export async function updateCampaign(id: string, patch: CampaignPatch): Promise<Result<{ added: number }>> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    const data: Prisma.CampaignUpdateInput = {};
    if (patch.name !== undefined) data.name = cleanName(patch.name);
    if (patch.type !== undefined) data.type = patch.type;
    if (patch.description !== undefined) data.description = patch.description?.trim() || null;
    if (patch.pitch !== undefined) data.pitch = patch.pitch?.trim() || null;
    if (patch.startDate !== undefined) data.startDate = date(patch.startDate);
    if (patch.endDate !== undefined) data.endDate = date(patch.endDate);
    if (patch.ownerId !== undefined) data.owner = patch.ownerId ? { connect: { id: patch.ownerId } } : { disconnect: true };
    if (patch.goals !== undefined) data.goals = json({ ...((c.goals ?? {}) as CampaignGoals), ...patch.goals });
    if (patch.settings !== undefined) data.settings = json({ ...parseSettings(c.settings), ...patch.settings });
    if (patch.criteria !== undefined) data.criteria = json(patch.criteria);
    if (patch.status !== undefined) {
      if (!STATUSES.includes(patch.status)) throw new Error("Unknown status");
      data.status = patch.status;
    }
    const start = patch.startDate !== undefined ? date(patch.startDate) : c.startDate;
    const end = patch.endDate !== undefined ? date(patch.endDate) : c.endDate;
    if (start && end && end < start) throw new Error("The campaign ends before it starts");

    await db.campaign.update({ where: { id }, data });
    await db.auditLog.create({ data: { action: "update_campaign", changes: json({ campaignId: id, ...patch }), userId: user.id } });

    let added = 0;
    if (patch.status === "ACTIVE" && c.status !== "ACTIVE") {
      // Launching: every current member enters the "In campaign" stage, then pick up criteria matches
      const members = await db.campaignCompany.findMany({ where: { campaignId: id, removedAt: null }, select: { companyId: true } });
      for (const m of members) await advanceJourney(m.companyId, STAGE.inCampaign, user.id, { source: "campaign", campaignId: id });
    }
    const after = await db.campaign.findUniqueOrThrow({ where: { id } });
    if (after.status === "ACTIVE" && parseSettings(after.settings).autoAdd && (patch.criteria || patch.settings || patch.status)) added = await syncCampaign(id, user.id);
    revalidate(id);
    return { ok: true, data: { added } };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteCampaign(id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    const calls = await db.activity.count({ where: { campaignId: id, deletedAt: null } });
    if (calls) throw new Error(`${calls} logged activities belong to this campaign, so archive it instead`);
    await db.campaign.delete({ where: { id } });
    await db.auditLog.create({ data: { action: "delete_campaign", changes: json({ campaignId: id, name: c.name }), userId: user.id } });
    revalidate();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cloneCampaign(id: string): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const c = await db.campaign.findUniqueOrThrow({ where: { id } });
    const copy = await db.campaign.create({
      data: {
        name: `${c.name} (copy)`.slice(0, 120),
        type: c.type,
        audience: c.audience,
        description: c.description,
        criteria: json(c.criteria),
        settings: json(c.settings),
        goals: json(c.goals),
        pitch: c.pitch,
        ownerId: user.id,
      },
    });
    revalidate(copy.id);
    return { ok: true, data: { id: copy.id } };
  } catch (e) {
    return fail(e);
  }
}

/** Count and sample of companies the criteria would add (before saving). */
export async function previewCriteria(
  groups: FilterGroup[],
  settings: Partial<CampaignSettings>,
  campaignId?: string,
): Promise<Result<{ total: number; newCount: number; sample: { id: string; name: string; domain: string | null; leadState: string | null }[] }>> {
  try {
    const user = await requireUser();
    const ctx = await loadQueryContext(user.id);
    const s = { ...DEFAULT_SETTINGS, ...settings };
    const where = await criteriaWhere(groups, s, ctx, campaignId);
    if (!where) return { ok: true, data: { total: 0, newCount: 0, sample: [] } };
    const w = where as Prisma.CompanyWhereInput;
    const newWhere = campaignId ? ((await criteriaWhere(groups, s, ctx, campaignId, true)) as Prisma.CompanyWhereInput) : w;
    const [total, newCount, sample] = await Promise.all([
      db.company.count({ where: w }),
      db.company.count({ where: newWhere }),
      db.company.findMany({ where: newWhere, select: { id: true, name: true, domain: true, leadState: true }, orderBy: { name: "asc" }, take: 8 }),
    ]);
    return { ok: true, data: { total, newCount, sample } };
  } catch (e) {
    return fail(e);
  }
}

export async function syncCampaignNow(id: string): Promise<Result<{ added: number }>> {
  try {
    const user = await requireUser();
    await editable(id, user.id);
    const added = await syncCampaign(id, user.id);
    revalidate(id);
    return { ok: true, data: { added } };
  } catch (e) {
    return fail(e);
  }
}

/** What adding a segment did, worded for the toast. */
interface SegmentAdd {
  added: number;
  skipped: number;
  unit: "company" | "person";
}

async function addSegmentMembers(campaignId: string, segmentId: string, userId: string): Promise<SegmentAdd> {
  const [seg, campaign] = await Promise.all([db.segment.findUniqueOrThrow({ where: { id: segmentId } }), db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { audience: true } })]);
  if (seg.objectType !== "COMPANY" && seg.objectType !== "CONTACT") throw new Error("Pick a company or contact segment");
  const ctx = await loadQueryContext(userId);
  // Contact campaigns target exactly the segment's people
  if (campaign.audience === "CONTACT") {
    if (seg.objectType !== "CONTACT") throw new Error("Contact campaigns take contact segments. Use a company campaign for company segments");
    const ids = (await db.contact.findMany({ where: segmentRecordsWhere("CONTACT", segmentId, ctx) as Prisma.ContactWhereInput, select: { id: true } })).map((r) => r.id);
    const res = await addPeople(campaignId, ids, "segment", userId);
    return { added: res.people, skipped: res.skipped, unit: "person" };
  }
  // A contact segment brings in the companies those people work at
  const where: Prisma.CompanyWhereInput =
    seg.objectType === "COMPANY"
      ? (segmentRecordsWhere("COMPANY", segmentId, ctx) as Prisma.CompanyWhereInput)
      : { deletedAt: null, contacts: { some: { contact: segmentRecordsWhere("CONTACT", segmentId, ctx) as Prisma.ContactWhereInput } } };
  // No cap: large segments come in whole
  const ids = (await db.company.findMany({ where, select: { id: true } })).map((r) => r.id);
  return { added: (await addMembers(campaignId, ids, "segment", userId)).length, skipped: 0, unit: "company" };
}

/** Add people to a Contact campaign (their companies join too). */
export async function addPeopleToCampaign(id: string, contactIds: string[]): Promise<Result<{ added: number; companies: number; skipped: number; already: number }>> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    if (c.audience !== "CONTACT") throw new Error("This is a company campaign. Add companies instead");
    if (!contactIds.length) throw new Error("Select people first");
    const res = await addPeople(id, contactIds, "manual", user.id);
    revalidate(id);
    return { ok: true, data: { added: res.people, companies: res.companies, skipped: res.skipped, already: res.already } };
  } catch (e) {
    return fail(e);
  }
}

/** Take people out of a Contact campaign. A company left with nobody to call leaves the campaign too. */
export async function removePeopleFromCampaign(id: string, contactIds: string[]): Promise<Result<{ companiesRemoved: number }>> {
  try {
    const user = await requireUser();
    await editable(id, user.id);
    const rows = await db.campaignContact.findMany({ where: { campaignId: id, contactId: { in: contactIds } }, select: { companyId: true } });
    await db.campaignContact.updateMany({ where: { campaignId: id, contactId: { in: contactIds } }, data: { removedAt: new Date() } });
    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    const left = await db.campaignContact.groupBy({ by: ["companyId"], where: { campaignId: id, companyId: { in: companyIds }, removedAt: null }, _count: { _all: true } });
    const empty = companyIds.filter((cid) => !left.some((l) => l.companyId === cid));
    if (empty.length) await removeFromCampaign(id, empty);
    await syncCompaniesFromPeople(id, companyIds.filter((cid) => !empty.includes(cid)));
    revalidate(id);
    return { ok: true, data: { companiesRemoved: empty.length } };
  } catch (e) {
    return fail(e);
  }
}

/** Put removed people back (undo). */
export async function restorePeopleToCampaign(id: string, contactIds: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    await editable(id, user.id);
    const rows = await db.campaignContact.findMany({ where: { campaignId: id, contactId: { in: contactIds } }, select: { companyId: true } });
    await db.campaignContact.updateMany({ where: { campaignId: id, contactId: { in: contactIds } }, data: { removedAt: null } });
    const companyIds = [...new Set(rows.map((r) => r.companyId))];
    await restoreToCampaign(id, companyIds);
    await syncCompaniesFromPeople(id, companyIds);
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function addCompaniesToCampaign(id: string, companyIds: string[]): Promise<Result<{ added: number; addedIds: string[] }>> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    if (c.audience === "CONTACT") throw new Error("This is a contact campaign. Add people from the Contacts list instead");
    if (!companyIds.length) throw new Error("Select companies first");
    const addedIds = await addMembers(id, companyIds, "manual", user.id);
    revalidate(id);
    return { ok: true, data: { added: addedIds.length, addedIds } };
  } catch (e) {
    return fail(e);
  }
}

export async function addSegmentToCampaign(id: string, segmentId: string): Promise<Result<SegmentAdd>> {
  try {
    const user = await requireUser();
    await editable(id, user.id);
    const res = await addSegmentMembers(id, segmentId, user.id);
    revalidate(id);
    return { ok: true, data: res };
  } catch (e) {
    return fail(e);
  }
}

/** Remove companies from a campaign. Rows are kept (removedAt) so criteria syncs don't add them back. */
export async function removeFromCampaign(id: string, companyIds: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    const now = new Date();
    await db.campaignCompany.updateMany({ where: { campaignId: id, companyId: { in: companyIds } }, data: { removedAt: now } });
    // Contact campaigns: the company's targeted people go with it
    await db.campaignContact.updateMany({ where: { campaignId: id, companyId: { in: companyIds }, removedAt: null }, data: { removedAt: now } });
    // A company that was only "In campaign" because of this campaign goes back to where it was
    for (const companyId of companyIds) {
      const co = await db.company.findUnique({ where: { id: companyId }, select: { leadState: true } });
      if (co?.leadState !== STAGE.inCampaign) continue;
      if (await db.campaignCompany.count({ where: { companyId, removedAt: null, campaign: { status: "ACTIVE" } } })) continue;
      const entered = await db.journeyEvent.findFirst({ where: { companyId, toStage: STAGE.inCampaign }, orderBy: { at: "desc" } });
      await applyUpdate("COMPANY", companyId, JOURNEY_PROPERTY, entered?.fromStage ?? STAGE.callable, user.id, {
        journey: { source: "campaign", campaignId: id, reason: `Removed from campaign "${c.name}"` },
      });
    }
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreToCampaign(id: string, companyIds: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    const c = await editable(id, user.id);
    // People removed together with their company come back with it (not ones taken out earlier on their own)
    const members = await db.campaignCompany.findMany({ where: { campaignId: id, companyId: { in: companyIds }, removedAt: { not: null } }, select: { companyId: true, removedAt: true } });
    for (const m of members) {
      await db.campaignContact.updateMany({ where: { campaignId: id, companyId: m.companyId, removedAt: { gte: m.removedAt! } }, data: { removedAt: null } });
    }
    await db.campaignCompany.updateMany({ where: { campaignId: id, companyId: { in: companyIds } }, data: { removedAt: null } });
    if (c.status === "ACTIVE") for (const companyId of companyIds) await advanceJourney(companyId, STAGE.inCampaign, user.id, { source: "campaign", campaignId: id });
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Set the campaign outcome for companies. Disqualified / Nurture also move the company's journey. */
export async function setMemberStatus(id: string, companyIds: string[], status: string, reason?: string): Promise<Result> {
  try {
    const user = await requireUser();
    const c = await db.campaign.findUniqueOrThrow({ where: { id }, select: { name: true } });
    const outcomes = await db.optionList.findUnique({ where: { key: "campaignMemberStatus" } });
    const allowed = ((outcomes?.options as { value: string }[] | null) ?? []).map((o) => o.value);
    if (!(allowed.length ? allowed : MEMBER_STATUSES).includes(status)) throw new Error("Unknown campaign outcome");
    await db.campaignCompany.updateMany({ where: { campaignId: id, companyId: { in: companyIds } }, data: { status } });
    const exit = status === "Disqualified" ? STAGE.disqualified : status === "Nurture" ? STAGE.nurture : status === "Meeting booked" ? STAGE.meeting : null;
    for (const companyId of exit ? companyIds : []) {
      const journey = { source: "campaign" as const, campaignId: id, reason: reason?.trim() || `${status} in campaign "${c.name}"` };
      if (exit === STAGE.meeting) await advanceJourney(companyId, exit, user.id, journey);
      else await applyUpdate("COMPANY", companyId, JOURNEY_PROPERTY, exit, user.id, { journey });
    }
    revalidate(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Assign companies to a caller, or spread unassigned companies evenly across several callers. */
export async function assignMembers(id: string, companyIds: string[], userIds: string[]): Promise<Result<{ assigned: number }>> {
  try {
    const user = await requireUser();
    await editable(id, user.id);
    if (!userIds.length) {
      await db.campaignCompany.updateMany({ where: { campaignId: id, companyId: { in: companyIds } }, data: { assignedToId: null } });
      revalidate(id);
      return { ok: true, data: { assigned: 0 } };
    }
    for (const [i, companyId] of companyIds.entries()) {
      await db.campaignCompany.update({ where: { campaignId_companyId: { campaignId: id, companyId } }, data: { assignedToId: userIds[i % userIds.length] } });
    }
    revalidate(id);
    return { ok: true, data: { assigned: companyIds.length } };
  } catch (e) {
    return fail(e);
  }
}

/** Round-robin every unassigned company in the campaign across the given callers. */
export async function distributeUnassigned(id: string, userIds: string[]): Promise<Result<{ assigned: number }>> {
  try {
    if (!userIds.length) throw new Error("Pick at least one caller");
    const rows = await db.campaignCompany.findMany({ where: { campaignId: id, removedAt: null, assignedToId: null }, select: { companyId: true }, orderBy: { addedAt: "asc" } });
    return assignMembers(id, rows.map((r) => r.companyId), userIds);
  } catch (e) {
    return fail(e);
  }
}

/** Calling queue: set when a company should come up again (null = back in its normal place). */
export async function snoozeMember(id: string, companyId: string, until: string | null): Promise<Result> {
  try {
    const user = await requireUser();
    const key = { campaignId_companyId: { campaignId: id, companyId } };
    const m = await db.campaignCompany.findUniqueOrThrow({ where: key, include: { campaign: { select: { ownerId: true } } } });
    if (m.assignedToId && m.assignedToId !== user.id && !(await canEditCampaign(m.campaign, user.id))) throw new Error("This company is assigned to another caller");
    const at = date(until);
    if (at && at.getTime() < Date.now() - 6e4) throw new Error("Pick a time in the future");
    await db.campaignCompany.update({ where: key, data: { nextActionAt: at, ...(m.assignedToId ? {} : { assignedToId: user.id }) } });
    revalidatePath(`/prospecting/${id}`);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function searchCampaigns(q: string, audience: "COMPANY" | "CONTACT" = "COMPANY") {
  await requireUser();
  return db.campaign.findMany({
    where: { status: { in: ["DRAFT", "ACTIVE", "PAUSED"] }, audience, ...(q.trim() ? { name: { contains: q.trim(), mode: "insensitive" } } : {}) },
    select: { id: true, name: true, status: true, type: true },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });
}
