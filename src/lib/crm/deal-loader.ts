import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import type { UserLite } from "./types";

export interface DealSearchParams {
  view?: string;
  pipeline?: string;
  owner?: string;
  close?: string;
  q?: string;
  status?: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);
const num = (d: Prisma.Decimal | null) => (d === null ? null : d.toNumber());

function closeWhere(close: string | undefined, now = new Date()): Prisma.DealWhereInput {
  if (close === "none") return { closeDate: null };
  if (close === "overdue") return { closeDate: { lt: now }, stage: { stageType: "OPEN" } };
  if (close === "month") return { closeDate: { gte: new Date(now.getFullYear(), now.getMonth(), 1), lt: new Date(now.getFullYear(), now.getMonth() + 1, 1) } };
  if (close === "quarter") {
    const q = Math.floor(now.getMonth() / 3) * 3;
    return { closeDate: { gte: new Date(now.getFullYear(), q, 1), lt: new Date(now.getFullYear(), q + 3, 1) } };
  }
  return {};
}

export async function loadDeals(userId: string, sp: DealSearchParams) {
  const pipelines = await db.pipeline.findMany({ where: { objectType: "DEAL" }, orderBy: { order: "asc" }, include: { stages: { orderBy: { order: "asc" } } } });
  const pipeline = pipelines.find((p) => p.id === sp.pipeline) ?? pipelines[0] ?? null;
  const q = sp.q?.trim() ?? "";
  const status = ["open", "won", "lost"].includes(sp.status ?? "") ? sp.status! : "";
  const where: Prisma.DealWhereInput = {
    deletedAt: null,
    pipelineId: pipeline?.id ?? "__none__",
    ...(sp.owner === "__me__" ? { ownerId: userId } : sp.owner === "__none__" ? { ownerId: null } : sp.owner ? { ownerId: sp.owner } : {}),
    ...closeWhere(sp.close),
    ...(status ? { stage: { stageType: status === "open" ? "OPEN" : status === "won" ? "WON" : "LOST" } } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { companies: { some: { company: { name: { contains: q, mode: "insensitive" } } } } }] } : {}),
  };
  const [deals, users, campaigns] = await Promise.all([
    db.deal.findMany({
      where,
      include: {
        companies: { orderBy: { isPrimary: "desc" }, select: { company: { select: { id: true, name: true, domain: true } } } },
        contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
      orderBy: [{ closeDate: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
      take: 2000,
    }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.campaign.findMany({ where: { status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } }, select: { name: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  // Next open task for each deal's company, so the board shows what happens next
  const companyIds = [...new Set(deals.flatMap((d) => d.companies.map((c) => c.company.id)))];
  const tasks = companyIds.length
    ? await db.activity.findMany({
        where: { type: "TASK", deletedAt: null, taskStatus: { not: "COMPLETED" }, OR: [{ deals: { some: { dealId: { in: deals.map((d) => d.id) } } } }, { companies: { some: { companyId: { in: companyIds } } } }] },
        select: { title: true, dueAt: true, deals: { select: { dealId: true } }, companies: { select: { companyId: true } } },
        orderBy: { dueAt: "asc" },
      })
    : [];

  const stages = pipeline?.stages ?? [];
  const rows = deals.map((d) => {
    const stage = stages.find((s) => s.id === d.stageId);
    const company = d.companies[0]?.company ?? null;
    const task = tasks.find((t) => t.deals.some((x) => x.dealId === d.id) || (company && t.companies.some((c) => c.companyId === company.id)));
    return {
      id: d.id,
      name: d.name,
      amount: num(d.amount),
      closeDate: iso(d.closeDate),
      stageId: d.stageId,
      stageEnteredAt: iso(d.stageEnteredAt),
      closedAt: iso(d.closedAt),
      ownerId: d.ownerId,
      dealType: d.dealType,
      lostReason: d.lostReason,
      createdAt: iso(d.createdAt),
      probability: stage?.probability ?? 0,
      stageType: stage?.stageType ?? "OPEN",
      company,
      contacts: d.contacts.map((c) => ({ id: c.contact.id, name: fullName(c.contact) })),
      next: task ? { label: task.title ?? "Task", at: iso(task.dueAt) } : null,
    };
  });

  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const open = rows.filter((r) => r.stageType === "OPEN");
  const won = rows.filter((r) => r.stageType === "WON");
  const wonThisMonth = won.filter((r) => r.closedAt && new Date(r.closedAt) >= monthStart);
  const lost = rows.filter((r) => r.stageType === "LOST");
  const sum = (list: typeof rows, weighted = false) => list.reduce((n, r) => n + (r.amount ?? 0) * (weighted ? r.probability / 100 : 1), 0);

  return {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name })),
    pipelineId: pipeline?.id ?? null,
    stages: stages.map((s) => ({ id: s.id, name: s.name, color: s.color, probability: s.probability, stageType: s.stageType })),
    rows,
    summary: {
      openCount: open.length,
      openAmount: sum(open),
      weighted: sum(open, true),
      wonThisMonth: { count: wonThisMonth.length, amount: sum(wonThisMonth) },
      winRate: won.length + lost.length ? Math.round((won.length / (won.length + lost.length)) * 100) : null,
      overdue: open.filter((r) => r.closeDate && new Date(r.closeDate) < now).length,
    },
    view: sp.view === "list" ? "list" : "board",
    filters: { owner: sp.owner ?? "", close: sp.close ?? "", q, status },
    users: users as UserLite[],
    campaigns: campaigns.map((c) => c.name),
    currentUserId: userId,
  };
}

export type DealsData = Awaited<ReturnType<typeof loadDeals>>;
export type DealRow = DealsData["rows"][number];

/** One deal with its company, people, timeline and stage history. */
export async function loadDeal(id: string, userId: string) {
  const deal = await db.deal.findUnique({
    where: { id },
    include: {
      pipeline: { include: { stages: { orderBy: { order: "asc" } } } },
      companies: { orderBy: { isPrimary: "desc" }, select: { company: { select: { id: true, name: true, domain: true, industry: true, country: true, timeZone: true, phone: true, leadState: true, followGroup: true, followScore: true } } } },
      contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, mobile: true, lifecycleStage: true } } } },
      leads: { where: { deletedAt: null }, select: { id: true, name: true, stage: true } },
    },
  });
  if (!deal || deal.deletedAt) return null;
  const companyIds = deal.companies.map((c) => c.company.id);
  const [activities, history, users] = await Promise.all([
    db.activity.findMany({
      where: {
        deletedAt: null,
        OR: [{ deals: { some: { dealId: id } } }, ...(companyIds.length ? [{ type: { not: "SYSTEM" as const }, companies: { some: { companyId: { in: companyIds } } } }] : [])],
      },
      select: {
        id: true,
        type: true,
        occurredAt: true,
        title: true,
        body: true,
        subject: true,
        callResult: true,
        feedbackRating: true,
        callPath: true,
        dialedNumber: true,
        dueAt: true,
        taskStatus: true,
        ownerId: true,
        systemData: true,
        contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } },
      },
      orderBy: { occurredAt: "desc" },
      take: 80,
    }),
    db.auditLog.findMany({ where: { objectType: "DEAL", recordId: id }, orderBy: { createdAt: "asc" }, select: { createdAt: true, changes: true } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);
  await db.recentView.upsert({
    where: { userId_objectType_recordId: { userId, objectType: "DEAL", recordId: id } },
    create: { userId, objectType: "DEAL", recordId: id },
    update: { viewedAt: new Date() },
  });
  // Days spent in each stage, from the stage changes on record
  const moves = history
    .map((h) => ({ at: h.createdAt, to: (h.changes as { stage?: { to?: string } } | null)?.stage?.to }))
    .filter((m): m is { at: Date; to: string } => !!m.to);
  const stageDays: Record<string, number> = {};
  moves.forEach((m, i) => {
    const end = moves[i + 1]?.at ?? new Date();
    stageDays[m.to] = (stageDays[m.to] ?? 0) + Math.max(0, (end.getTime() - m.at.getTime()) / 864e5);
  });
  // Deals from before stage tracking: only the current stage's time is known
  if (!moves.length) {
    const current = deal.pipeline.stages.find((s) => s.id === deal.stageId);
    if (current) stageDays[current.name] = (Date.now() - deal.stageEnteredAt.getTime()) / 864e5;
  }

  return {
    deal: {
      id: deal.id,
      name: deal.name,
      amount: num(deal.amount),
      closeDate: iso(deal.closeDate),
      ownerId: deal.ownerId,
      dealType: deal.dealType,
      sourceCampaign: deal.sourceCampaign,
      lostReason: deal.lostReason,
      stageId: deal.stageId,
      stageEnteredAt: iso(deal.stageEnteredAt),
      closedAt: iso(deal.closedAt),
      createdAt: iso(deal.createdAt),
    },
    pipeline: { id: deal.pipeline.id, name: deal.pipeline.name },
    stages: deal.pipeline.stages.map((s) => ({ id: s.id, name: s.name, color: s.color, probability: s.probability, stageType: s.stageType, days: Math.round(stageDays[s.name] ?? 0) })),
    companies: deal.companies.map((c) => c.company),
    contacts: deal.contacts.map((c) => ({ ...c.contact, name: fullName(c.contact) })),
    leads: deal.leads,
    activities: activities.map((a) => ({
      ...a,
      occurredAt: a.occurredAt.toISOString(),
      dueAt: iso(a.dueAt),
      systemData: a.systemData as Record<string, unknown> | null,
      contacts: a.contacts.map((c) => ({ id: c.contact.id, name: fullName(c.contact) })),
    })),
    users: users as UserLite[],
  };
}

export type DealData = NonNullable<Awaited<ReturnType<typeof loadDeal>>>;
