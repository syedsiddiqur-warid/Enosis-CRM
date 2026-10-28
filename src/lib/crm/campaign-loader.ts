import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { campaignStats, parseSettings, syncCampaign, type CampaignGoals } from "./campaigns";
import { loadQueryContext, parseSegmentGroups } from "./context";
import { getPropertyGroups } from "./properties";
import { segmentSummaries } from "./segments";
import type { PropOption, UserLite } from "./types";

const PAGE_SIZE = 50;

async function roleOf(userId: string) {
  return (await db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } }))?.role?.name ?? null;
}

export async function canEditCampaign(campaign: { ownerId: string | null }, userId: string) {
  if (campaign.ownerId === userId) return true;
  return ["Admin", "Manager"].includes((await roleOf(userId)) ?? "");
}

async function optionList(key: string) {
  const l = await db.optionList.findUnique({ where: { key } });
  return ((l?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);
}

export async function loadCampaigns(userId: string, showArchived: boolean) {
  const [rows, users, types] = await Promise.all([
    db.campaign.findMany({
      where: showArchived ? {} : { status: { not: "ARCHIVED" } },
      include: { owner: { select: { id: true, name: true, email: true } } },
      orderBy: [{ status: "asc" }, { updatedAt: "desc" }],
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    optionList("campaignType"),
  ]);
  const stats = await campaignStats(rows.map((r) => r.id));
  return {
    campaigns: rows.map((c) => ({
      id: c.id,
      name: c.name,
      description: c.description,
      type: c.type,
      status: c.status,
      owner: c.owner ? { id: c.owner.id, name: c.owner.name ?? c.owner.email } : null,
      startDate: c.startDate?.toISOString() ?? null,
      endDate: c.endDate?.toISOString() ?? null,
      goals: (c.goals ?? {}) as CampaignGoals,
      hasCriteria: parseSegmentGroups(c.criteria).length > 0,
      stats: stats.get(c.id)!,
      updatedAt: c.updatedAt.toISOString(),
    })),
    users: users as UserLite[],
    types,
  };
}

export type CampaignListData = Awaited<ReturnType<typeof loadCampaigns>>;

export interface CampaignSearchParams {
  status?: string;
  q?: string;
  page?: string;
  tab?: string;
  owner?: string;
}

export async function loadCampaign(id: string, userId: string, sp: CampaignSearchParams) {
  const campaign = await db.campaign.findUnique({ where: { id }, include: { owner: { select: { id: true, name: true, email: true } } } });
  if (!campaign) return null;
  const ctx = await loadQueryContext(userId);

  // Live campaigns keep picking up companies that start matching the criteria
  const settings = parseSettings(campaign.settings);
  let autoAdded = 0;
  if (campaign.status === "ACTIVE" && settings.autoAdd) autoAdded = await syncCampaign(id, userId, ctx);

  const page = Math.max(1, Number(sp.page) || 1);
  const q = sp.q?.trim() ?? "";
  const memberWhere: Prisma.CampaignCompanyWhereInput = {
    campaignId: id,
    removedAt: null,
    company: { deletedAt: null, ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] } : {}) },
    ...(sp.status ? { status: sp.status } : {}),
    ...(sp.owner === "__me__" ? { assignedToId: userId } : sp.owner === "__none__" ? { assignedToId: null } : sp.owner ? { assignedToId: sp.owner } : {}),
  };

  const [members, total, stats, outcomes, journey, users, memberStatuses, callResults, types, segments, groups, canEdit] = await Promise.all([
    db.campaignCompany.findMany({
      where: memberWhere,
      include: {
        company: {
          select: {
            id: true,
            name: true,
            domain: true,
            leadState: true,
            country: true,
            timeZone: true,
            industry: true,
            employees: true,
            signalTypes: true,
            callStatus: true,
            _count: { select: { contacts: true } },
          },
        },
        assignedTo: { select: { id: true, name: true } },
      },
      orderBy: [{ nextActionAt: { sort: "asc", nulls: "last" } }, { addedAt: "asc" }],
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.campaignCompany.count({ where: memberWhere }),
    campaignStats([id]),
    db.activity.groupBy({ by: ["callResult"], where: { campaignId: id, type: "CALL", deletedAt: null }, _count: { _all: true } }),
    db.company.groupBy({ by: ["leadState"], where: { deletedAt: null, campaigns: { some: { campaignId: id, removedAt: null } } }, _count: { _all: true } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    optionList("campaignMemberStatus"),
    optionList("callResult"),
    optionList("campaignType"),
    segmentSummaries(userId, "COMPANY"),
    getPropertyGroups("COMPANY"),
    canEditCampaign(campaign, userId),
  ]);
  const journeyOptions = ctx.defs.COMPANY.find((d) => d.name === "leadState")?.options ?? [];

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      description: campaign.description,
      type: campaign.type,
      status: campaign.status,
      owner: campaign.owner ? { id: campaign.owner.id, name: campaign.owner.name ?? campaign.owner.email } : null,
      startDate: campaign.startDate?.toISOString() ?? null,
      endDate: campaign.endDate?.toISOString() ?? null,
      criteria: parseSegmentGroups(campaign.criteria),
      settings,
      goals: (campaign.goals ?? {}) as CampaignGoals,
      pitch: campaign.pitch,
      createdAt: campaign.createdAt.toISOString(),
    },
    autoAdded,
    stats: stats.get(id)!,
    outcomes: outcomes.map((o) => ({ result: o.callResult ?? "Unknown", count: o._count._all })).sort((a, b) => b.count - a.count),
    journey: journeyOptions.map((o) => ({ stage: o.value, color: o.color, count: journey.find((j) => j.leadState === o.value)?._count._all ?? 0 })).filter((j) => j.count),
    members: members.map((m) => ({
      companyId: m.companyId,
      name: m.company.name,
      domain: m.company.domain,
      leadState: m.company.leadState,
      country: m.company.country,
      timeZone: m.company.timeZone,
      industry: m.company.industry,
      employees: m.company.employees,
      signalTypes: m.company.signalTypes,
      callStatus: m.company.callStatus,
      contacts: m.company._count.contacts,
      status: m.status,
      addedVia: m.addedVia,
      addedAt: m.addedAt.toISOString(),
      assignedTo: m.assignedTo,
      attempts: m.attempts,
      connects: m.connects,
      lastResult: m.lastResult,
      lastCallAt: m.lastCallAt?.toISOString() ?? null,
      nextActionAt: m.nextActionAt?.toISOString() ?? null,
    })),
    total,
    page,
    pageSize: PAGE_SIZE,
    q,
    statusFilter: sp.status ?? "",
    ownerFilter: sp.owner ?? "",
    tab: sp.tab === "criteria" || sp.tab === "settings" ? sp.tab : "companies",
    users: users as UserLite[],
    memberStatuses,
    callResults,
    types,
    journeyOptions,
    // Criteria editor
    defs: ctx.defs.COMPANY,
    associatedDefs: ctx.defs.CONTACT,
    relatedDefs: ctx.relatedDefs,
    segments,
    groups,
    canEdit,
    currentUserId: userId,
  };
}

export type CampaignData = NonNullable<Awaited<ReturnType<typeof loadCampaign>>>;
