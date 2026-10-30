// Campaigns: sets of companies chosen by criteria (ICP, buying signals, call history, journey
// stage…) and/or by hand, worked by callers. Server-only helpers; actions live in campaign-actions.ts.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { loadQueryContext, parseSegmentGroups } from "./context";
import { JOURNEY_PROPERTY, STAGE } from "./journey";
import { groupsWhere, type QueryContext, type Where } from "./query";
import { advanceJourney } from "./record-writes";
import type { FilterGroup, PropOption } from "./types";

export interface CampaignSettings {
  /** Active campaigns keep adding companies that start matching the criteria */
  autoAdd: boolean;
  /** Only companies marked Callable = Yes */
  requireCallable: boolean;
  /** Skip companies in an exit stage (Not viable, Disqualified, Do not contact…) */
  excludeExitStages: boolean;
  /** Skip companies already in another active campaign */
  excludeOtherActive: boolean;
  /** Skip companies contacted within this many days */
  excludeContactedDays: number | null;
  /** Suggested attempts per company before moving on (shown to callers) */
  maxAttempts: number | null;
}

export interface CampaignGoals {
  companies?: number | null;
  connects?: number | null;
  meetings?: number | null;
}

export const DEFAULT_SETTINGS: CampaignSettings = {
  autoAdd: true,
  requireCallable: true,
  excludeExitStages: true,
  excludeOtherActive: false,
  excludeContactedDays: null,
  maxAttempts: 6,
};

export const MEMBER_STATUSES = ["Queued", "In progress", "Connected", "Meeting booked", "Not interested", "Nurture", "Disqualified", "Completed"];
/** Member statuses that count as "worked" (at least reached a decision) */
export const CLOSED_STATUSES = ["Meeting booked", "Not interested", "Disqualified", "Completed"];
const SYNC_LIMIT = 5000;

export function parseSettings(v: unknown): CampaignSettings {
  return { ...DEFAULT_SETTINGS, ...((v ?? {}) as Partial<CampaignSettings>) };
}

async function exitStages() {
  const def = await db.propertyDefinition.findUnique({ where: { objectType_name: { objectType: "COMPANY", name: JOURNEY_PROPERTY } }, select: { options: true } });
  return ((def?.options as PropOption[] | null) ?? []).filter((o) => o.kind === "exit").map((o) => o.value);
}

/** Companies that match a campaign's criteria and exclusion settings. `onlyNew` skips companies
 *  that were ever members (removed members are not added back). Empty criteria match nothing. */
export async function criteriaWhere(groups: FilterGroup[], settings: CampaignSettings, ctx: QueryContext, campaignId?: string, onlyNew = false): Promise<Where | null> {
  const criteria = groupsWhere("COMPANY", groups, ctx);
  if (!criteria) return null;
  const and: Where[] = [{ deletedAt: null }, criteria];
  if (settings.requireCallable) and.push({ properties: { path: ["callable"], equals: "Yes" } });
  if (settings.excludeExitStages) {
    const exits = await exitStages();
    if (exits.length) and.push({ OR: [{ leadState: null }, { leadState: { notIn: exits } }] });
  }
  if (settings.excludeOtherActive) {
    and.push({ campaigns: { none: { removedAt: null, campaign: { status: "ACTIVE", ...(campaignId ? { id: { not: campaignId } } : {}) } } } });
  }
  if (settings.excludeContactedDays) {
    and.push({ OR: [{ lastContactedAt: null }, { lastContactedAt: { lt: new Date(Date.now() - settings.excludeContactedDays * 864e5) } }] });
  }
  if (campaignId && onlyNew) and.push({ campaigns: { none: { campaignId } } });
  return { AND: and };
}

const chunk = <T>(list: T[], size: number) => Array.from({ length: Math.ceil(list.length / size) }, (_, i) => list.slice(i * size, (i + 1) * size));

/** Add companies to a campaign (skips current members; re-adds removed ones only when added by hand). */
export async function addMembers(campaignId: string, companyIds: string[], via: "criteria" | "manual" | "segment", userId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { status: true } });
  // Large segments: query and write in chunks so no single statement gets too big
  const existing = (
    await Promise.all(chunk(companyIds, 5000).map((ids) => db.campaignCompany.findMany({ where: { campaignId, companyId: { in: ids } }, select: { companyId: true, removedAt: true } })))
  ).flat();
  const current = new Set(existing.filter((m) => !m.removedAt).map((m) => m.companyId));
  const removed = new Set(existing.filter((m) => m.removedAt).map((m) => m.companyId));
  const fresh = companyIds.filter((id) => !current.has(id) && !removed.has(id));
  const readd = via === "criteria" ? [] : companyIds.filter((id) => removed.has(id));

  for (const ids of chunk(fresh, 5000)) {
    await db.campaignCompany.createMany({ data: ids.map((companyId) => ({ campaignId, companyId, addedVia: via, addedById: userId })), skipDuplicates: true });
  }
  for (const ids of chunk(readd, 5000)) {
    await db.campaignCompany.updateMany({ where: { campaignId, companyId: { in: ids } }, data: { removedAt: null, addedVia: via, addedById: userId, addedAt: new Date(), status: "Queued" } });
  }
  const added = [...fresh, ...readd];
  // Joining a live campaign moves the company along its journey
  if (campaign.status === "ACTIVE") {
    for (const ids of chunk(added, 10)) await Promise.all(ids.map((id) => advanceJourney(id, STAGE.inCampaign, userId, { source: "campaign", campaignId })));
  }
  return added;
}

// ── Contact campaigns ──

/** A targeted person needs no more calls: a final outcome, or out of attempts. */
export function personDone(p: { status: string; attempts: number }, maxAttempts: number | null) {
  return CLOSED_STATUSES.includes(p.status) || p.status === "Nurture" || (!!maxAttempts && p.attempts >= maxAttempts);
}

/** Add people to a Contact campaign: each is called through their primary company, which joins the campaign too.
 *  People without a company can't be called from the queue, so they're skipped. */
export async function addPeople(campaignId: string, contactIds: string[], via: "manual" | "segment", userId: string) {
  const links = (
    await Promise.all(
      chunk([...new Set(contactIds)], 5000).map((ids) =>
        db.contactCompany.findMany({
          where: { contactId: { in: ids }, contact: { deletedAt: null }, company: { deletedAt: null } },
          select: { contactId: true, companyId: true, isPrimary: true },
          orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
        }),
      ),
    )
  ).flat();
  const companyOf = new Map<string, string>();
  for (const l of links) if (!companyOf.has(l.contactId)) companyOf.set(l.contactId, l.companyId);
  const ids = [...companyOf.keys()];
  const skipped = new Set(contactIds).size - ids.length;

  const existing = (
    await Promise.all(chunk(ids, 5000).map((part) => db.campaignContact.findMany({ where: { campaignId, contactId: { in: part } }, select: { contactId: true, removedAt: true } })))
  ).flat();
  const current = new Set(existing.filter((p) => !p.removedAt).map((p) => p.contactId));
  const removed = new Set(existing.filter((p) => p.removedAt).map((p) => p.contactId));
  const fresh = ids.filter((id) => !current.has(id) && !removed.has(id));
  const readd = ids.filter((id) => removed.has(id));
  for (const part of chunk(fresh, 5000)) {
    await db.campaignContact.createMany({
      data: part.map((contactId) => ({ campaignId, contactId, companyId: companyOf.get(contactId)!, addedVia: via, addedById: userId })),
      skipDuplicates: true,
    });
  }
  for (const part of chunk(readd, 5000)) {
    await db.campaignContact.updateMany({ where: { campaignId, contactId: { in: part } }, data: { removedAt: null, addedVia: via, addedById: userId, addedAt: new Date(), status: "Queued", attempts: 0, connects: 0 } });
  }
  const addedPeople = [...fresh, ...readd];
  const companyIds = [...new Set(addedPeople.map((id) => companyOf.get(id)!))];
  const addedCompanies = await addMembers(campaignId, companyIds, via, userId);
  // Companies already in the campaign (maybe finished) reopen for their new people
  await syncCompaniesFromPeople(campaignId, companyIds.filter((id) => !addedCompanies.includes(id)));
  return { people: addedPeople.length, companies: addedCompanies.length, skipped, already: current.size };
}

/** A Contact campaign company's outcome follows its targeted people: it stays open until every one of them is done. */
export async function syncCompaniesFromPeople(campaignId: string, companyIds: string[]) {
  if (!companyIds.length) return;
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { settings: true } });
  const max = parseSettings(campaign.settings).maxAttempts;
  for (const ids of chunk(companyIds, 1000)) {
    const [people, members] = await Promise.all([
      db.campaignContact.findMany({ where: { campaignId, companyId: { in: ids }, removedAt: null }, select: { companyId: true, status: true, attempts: true } }),
      db.campaignCompany.findMany({ where: { campaignId, companyId: { in: ids }, removedAt: null }, select: { companyId: true, status: true } }),
    ]);
    for (const m of members) {
      // Set by hand on the campaign page; leave it
      if (m.status === "Disqualified") continue;
      const mine = people.filter((p) => p.companyId === m.companyId);
      if (!mine.length) continue;
      const has = (s: string) => mine.some((p) => p.status === s);
      const status = mine.every((p) => personDone(p, max))
        ? has("Meeting booked")
          ? "Meeting booked"
          : has("Not interested")
            ? "Not interested"
            : has("Nurture")
              ? "Nurture"
              : "Completed"
        : has("Meeting booked") || has("Connected")
          ? "Connected"
          : mine.some((p) => p.status !== "Queued")
            ? "In progress"
            : "Queued";
      if (status !== m.status) await db.campaignCompany.update({ where: { campaignId_companyId: { campaignId, companyId: m.companyId } }, data: { status } });
    }
  }
}

/** Add every company that newly matches the criteria. Returns the number added. */
export async function syncCampaign(campaignId: string, userId: string, ctx?: QueryContext) {
  const c = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
  const groups = parseSegmentGroups(c.criteria);
  if (!groups.length) return 0;
  const where = await criteriaWhere(groups, parseSettings(c.settings), ctx ?? (await loadQueryContext(userId)), campaignId, true);
  if (!where) return 0;
  const ids = (await db.company.findMany({ where: where as Prisma.CompanyWhereInput, select: { id: true }, take: SYNC_LIMIT })).map((r) => r.id);
  if (!ids.length) return 0;
  return (await addMembers(campaignId, ids, "criteria", userId)).length;
}

export interface CampaignStats {
  members: number;
  byStatus: Record<string, number>;
  /** Calls logged for the campaign */
  calls: number;
  connects: number;
  meetings: number;
  /** Members no longer Queued */
  called: number;
  /** Contact campaigns: targeted people, how many were reached, meetings with them */
  people: number;
  peopleReached: number;
  peopleMeetings: number;
}

/** Per-status member counts and call totals for a set of campaigns. */
export async function campaignStats(ids: string[]): Promise<Map<string, CampaignStats>> {
  const [byStatus, totals] = await Promise.all([
    db.campaignCompany.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids }, removedAt: null }, _count: { _all: true } }),
    db.campaignCompany.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids }, removedAt: null }, _sum: { attempts: true, connects: true } }),
  ]);
  const out = new Map<string, CampaignStats>();
  for (const id of ids) out.set(id, { members: 0, byStatus: {}, calls: 0, connects: 0, meetings: 0, called: 0, people: 0, peopleReached: 0, peopleMeetings: 0 });
  for (const r of byStatus) {
    const s = out.get(r.campaignId)!;
    s.byStatus[r.status] = r._count._all;
    s.members += r._count._all;
    if (r.status === "Meeting booked") s.meetings += r._count._all;
    if (r.status !== "Queued") s.called += r._count._all;
  }
  for (const r of totals) {
    const s = out.get(r.campaignId)!;
    s.calls = r._sum.attempts ?? 0;
    s.connects = r._sum.connects ?? 0;
  }
  const people = await db.campaignContact.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids }, removedAt: null }, _count: { _all: true } });
  for (const r of people) {
    const s = out.get(r.campaignId)!;
    s.people += r._count._all;
    if (["Connected", "Meeting booked", "Not interested", "Nurture"].includes(r.status)) s.peopleReached += r._count._all;
    if (r.status === "Meeting booked") s.peopleMeetings += r._count._all;
  }
  return out;
}

/** Active campaigns a company is in, for the call composer and record page. */
export async function companyCampaigns(companyIds: string[]) {
  if (!companyIds.length) return [];
  const rows = await db.campaignCompany.findMany({
    where: { companyId: { in: companyIds }, removedAt: null, campaign: { status: { not: "ARCHIVED" } } },
    include: { campaign: { select: { id: true, name: true, status: true, type: true, pitch: true } }, assignedTo: { select: { id: true, name: true } } },
    orderBy: { addedAt: "desc" },
  });
  return rows.map((m) => ({
    campaignId: m.campaignId,
    companyId: m.companyId,
    name: m.campaign.name,
    type: m.campaign.type,
    campaignStatus: m.campaign.status,
    pitch: m.campaign.pitch,
    status: m.status,
    attempts: m.attempts,
    connects: m.connects,
    lastResult: m.lastResult,
    lastCallAt: m.lastCallAt?.toISOString() ?? null,
    nextActionAt: m.nextActionAt?.toISOString() ?? null,
    addedAt: m.addedAt.toISOString(),
    assignedTo: m.assignedTo,
  }));
}

export type CompanyCampaign = Awaited<ReturnType<typeof companyCampaigns>>[number];
