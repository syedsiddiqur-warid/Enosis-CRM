import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { FOLLOW_GROUPS } from "./follow-up";
import type { UserLite } from "./types";

export const FOLLOW_PAGE = 50;
/** Good leads with no call for this long and nothing scheduled count as forgotten. */
export const FORGOTTEN_DAYS = 14;

export interface FollowSearchParams {
  group?: string;
  caller?: string;
  q?: string;
  page?: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Hot/warm companies nobody is following up: no open task, nothing scheduled in a campaign, no revisit date, no recent call. */
export function forgottenWhere(now = new Date()): Prisma.CompanyWhereInput {
  const cut = new Date(now.getTime() - FORGOTTEN_DAYS * 864e5);
  return {
    followGroup: { in: ["Chase now", "Nurture"] },
    AND: [
      { OR: [{ lastCallAt: null }, { lastCallAt: { lt: cut } }] },
      { OR: [{ revisitAt: null }, { revisitAt: { lt: now } }] },
      { activities: { none: { activity: { type: "TASK", deletedAt: null, taskStatus: { not: "COMPLETED" } } } } },
      { campaigns: { none: { removedAt: null, nextActionAt: { gt: now } } } },
    ],
  };
}

export async function loadFollowUps(userId: string, sp: FollowSearchParams) {
  const group = sp.group === "forgotten" || FOLLOW_GROUPS.includes(sp.group as never) ? sp.group! : "";
  const q = sp.q?.trim() ?? "";
  const page = Math.max(1, Number(sp.page) || 1);
  const base: Prisma.CompanyWhereInput = {
    deletedAt: null,
    followGroup: { not: null },
    ...(sp.caller === "__me__" ? { followCallerId: userId } : sp.caller ? { followCallerId: sp.caller } : {}),
    ...(q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { domain: { contains: q, mode: "insensitive" } }] } : {}),
  };
  const where: Prisma.CompanyWhereInput = group === "forgotten" ? { AND: [base, forgottenWhere()] } : group ? { ...base, followGroup: group } : base;

  const [rows, total, byGroup, forgotten, users] = await Promise.all([
    db.company.findMany({
      where,
      select: {
        id: true,
        name: true,
        domain: true,
        industry: true,
        employees: true,
        country: true,
        timeZone: true,
        followScore: true,
        followGroup: true,
        followReason: true,
        followCallerId: true,
        revisitAt: true,
        lastCallAt: true,
        crtCount: true,
      },
      orderBy: [{ followScore: "desc" }, { lastCallAt: { sort: "desc", nulls: "last" } }],
      skip: (page - 1) * FOLLOW_PAGE,
      take: FOLLOW_PAGE,
    }),
    db.company.count({ where }),
    db.company.groupBy({ by: ["followGroup"], where: base, _count: { _all: true } }),
    db.company.count({ where: { AND: [base, forgottenWhere()] } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
  ]);

  // Next step for each row: the earliest open task, or the next scheduled call in a campaign, or the revisit date
  const ids = rows.map((r) => r.id);
  const [tasks, members] = await Promise.all([
    db.activity.findMany({
      where: { type: "TASK", deletedAt: null, taskStatus: { not: "COMPLETED" }, companies: { some: { companyId: { in: ids } } } },
      select: { title: true, dueAt: true, companies: { select: { companyId: true } } },
      orderBy: { dueAt: "asc" },
    }),
    db.campaignCompany.findMany({
      where: { companyId: { in: ids }, removedAt: null, campaign: { status: { in: ["ACTIVE", "PAUSED", "DRAFT"] } } },
      select: { companyId: true, nextActionAt: true, status: true, campaign: { select: { id: true, name: true } } },
    }),
  ]);
  const userName = (id: string | null) => (id ? (users.find((u) => u.id === id)?.name ?? null) : null);

  return {
    rows: rows.map((r) => {
      const task = tasks.find((t) => t.companies.some((c) => c.companyId === r.id));
      const mine = members.filter((m) => m.companyId === r.id);
      const scheduled = mine.filter((m) => m.nextActionAt).sort((a, b) => a.nextActionAt!.getTime() - b.nextActionAt!.getTime())[0];
      const next =
        task && (!scheduled || (task.dueAt ?? new Date(8.64e15)) <= scheduled.nextActionAt!)
          ? { label: task.title ?? "Task", at: iso(task.dueAt) }
          : scheduled
            ? { label: `Call in ${scheduled.campaign.name}`, at: iso(scheduled.nextActionAt) }
            : r.revisitAt
              ? { label: "Revisit", at: iso(r.revisitAt) }
              : null;
      return {
        ...r,
        revisitAt: iso(r.revisitAt),
        lastCallAt: iso(r.lastCallAt),
        caller: userName(r.followCallerId),
        next,
        campaigns: mine.map((m) => ({ id: m.campaign.id, name: m.campaign.name, status: m.status })),
      };
    }),
    total,
    page,
    counts: {
      all: byGroup.reduce((n, g) => n + g._count._all, 0),
      forgotten,
      ...Object.fromEntries(FOLLOW_GROUPS.map((g) => [g, byGroup.find((x) => x.followGroup === g)?._count._all ?? 0])),
    } as Record<string, number>,
    filters: { group, caller: sp.caller ?? "", q },
    users: users as UserLite[],
    currentUserId: userId,
  };
}

export type FollowData = Awaited<ReturnType<typeof loadFollowUps>>;
