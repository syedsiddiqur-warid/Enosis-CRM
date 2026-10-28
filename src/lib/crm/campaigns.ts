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

/** Add companies to a campaign (skips current members; re-adds removed ones only when added by hand). */
export async function addMembers(campaignId: string, companyIds: string[], via: "criteria" | "manual" | "segment", userId: string) {
  const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId }, select: { status: true } });
  const existing = await db.campaignCompany.findMany({ where: { campaignId, companyId: { in: companyIds } }, select: { companyId: true, removedAt: true } });
  const current = new Set(existing.filter((m) => !m.removedAt).map((m) => m.companyId));
  const removed = new Set(existing.filter((m) => m.removedAt).map((m) => m.companyId));
  const fresh = companyIds.filter((id) => !current.has(id) && !removed.has(id));
  const readd = via === "criteria" ? [] : companyIds.filter((id) => removed.has(id));

  await db.campaignCompany.createMany({ data: fresh.map((companyId) => ({ campaignId, companyId, addedVia: via, addedById: userId })), skipDuplicates: true });
  if (readd.length) {
    await db.campaignCompany.updateMany({ where: { campaignId, companyId: { in: readd } }, data: { removedAt: null, addedVia: via, addedById: userId, addedAt: new Date(), status: "Queued" } });
  }
  const added = [...fresh, ...readd];
  // Joining a live campaign moves the company along its journey
  if (campaign.status === "ACTIVE") for (const id of added) await advanceJourney(id, STAGE.inCampaign, userId, { source: "campaign", campaignId });
  return added;
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
}

/** Per-status member counts and call totals for a set of campaigns. */
export async function campaignStats(ids: string[]): Promise<Map<string, CampaignStats>> {
  const [byStatus, totals] = await Promise.all([
    db.campaignCompany.groupBy({ by: ["campaignId", "status"], where: { campaignId: { in: ids }, removedAt: null }, _count: { _all: true } }),
    db.campaignCompany.groupBy({ by: ["campaignId"], where: { campaignId: { in: ids }, removedAt: null }, _sum: { attempts: true, connects: true } }),
  ]);
  const out = new Map<string, CampaignStats>();
  for (const id of ids) out.set(id, { members: 0, byStatus: {}, calls: 0, connects: 0, meetings: 0, called: 0 });
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
