import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { LEAD_STAGE_NAMES, OPEN_LEAD_STAGES, type LeadStage } from "./leads";
import type { UserLite } from "./types";

export const LEAD_PAGE = 50;
/** Open leads with no call for this long count as going cold. */
export const STALE_DAYS = 7;
/** The board shows at most this many cards per stage. */
const BOARD_CARDS = 100;

export interface LeadSearchParams {
  view?: string;
  stage?: string;
  owner?: string;
  label?: string;
  q?: string;
  page?: string;
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

export function staleWhere(now = new Date()): Prisma.LeadWhereInput {
  const cut = new Date(now.getTime() - STALE_DAYS * 864e5);
  return { stage: { in: OPEN_LEAD_STAGES }, OR: [{ lastTouchAt: null, createdAt: { lt: cut } }, { lastTouchAt: { lt: cut } }] };
}

const leadSelect = {
  id: true,
  name: true,
  stage: true,
  stageEnteredAt: true,
  label: true,
  leadType: true,
  source: true,
  touches: true,
  lastTouchAt: true,
  lastResult: true,
  ownerId: true,
  disqualifyReason: true,
  createdAt: true,
  campaign: { select: { id: true, name: true } },
  deal: { select: { id: true, name: true } },
  contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, mobile: true, timeZone: true } },
  company: { select: { id: true, name: true, domain: true, timeZone: true, followGroup: true, followScore: true } },
} satisfies Prisma.LeadSelect;

export async function loadLeads(userId: string, sp: LeadSearchParams) {
  const view = sp.view === "list" ? "list" : "board";
  const q = sp.q?.trim() ?? "";
  const stage = sp.stage === "stale" || LEAD_STAGE_NAMES.includes(sp.stage as LeadStage) ? sp.stage! : "";
  const page = Math.max(1, Number(sp.page) || 1);
  // Default: my leads
  const owner = sp.owner ?? "__me__";
  const base: Prisma.LeadWhereInput = {
    deletedAt: null,
    contact: { deletedAt: null },
    ...(owner === "__me__" ? { ownerId: userId } : owner === "__none__" ? { ownerId: null } : owner && owner !== "__all__" ? { ownerId: owner } : {}),
    ...(sp.label ? { label: sp.label === "__none__" ? null : sp.label } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { contact: { email: { contains: q, mode: "insensitive" } } },
            { company: { name: { contains: q, mode: "insensitive" } } },
          ],
        }
      : {}),
  };
  const where: Prisma.LeadWhereInput = stage === "stale" ? { AND: [base, staleWhere()] } : stage ? { ...base, stage } : base;

  const boardStages = stage && stage !== "stale" ? [stage] : LEAD_STAGE_NAMES;
  const [leads, total, byStage, stale, users, hasLeads, uncreated] = await Promise.all([
    view === "board"
      ? Promise.all(
          boardStages.map((s) =>
            db.lead.findMany({
              where: { AND: [where, { stage: s }] },
              select: leadSelect,
              // Open stages: never-called first, then most recently worked; closed stages: most recently closed first
              orderBy: OPEN_LEAD_STAGES.includes(s as LeadStage) ? [{ lastTouchAt: { sort: "desc", nulls: "first" } }, { createdAt: "desc" }] : [{ stageEnteredAt: "desc" }],
              take: BOARD_CARDS,
            }),
          ),
        ).then((lists) => lists.flat())
      : db.lead.findMany({ where, select: leadSelect, orderBy: [{ stageEnteredAt: "desc" }], skip: (page - 1) * LEAD_PAGE, take: LEAD_PAGE }),
    db.lead.count({ where }),
    db.lead.groupBy({ by: ["stage"], where: base, _count: { _all: true } }),
    db.lead.count({ where: { AND: [base, staleWhere()] } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.lead.count({ where: { deletedAt: null } }),
    // People who were called but never had a lead: what "Create from call history" would add
    db.contact.count({ where: { deletedAt: null, doNotCall: false, leads: { none: {} }, activities: { some: { activity: { type: "CALL", deletedAt: null } } } } }),
  ]);

  // Next open task for each lead's person
  const contactIds = leads.map((l) => l.contact.id);
  const tasks = contactIds.length
    ? await db.activity.findMany({
        where: { type: "TASK", deletedAt: null, taskStatus: { not: "COMPLETED" }, contacts: { some: { contactId: { in: contactIds } } } },
        select: { title: true, dueAt: true, contacts: { select: { contactId: true } } },
        orderBy: { dueAt: "asc" },
      })
    : [];

  return {
    rows: leads.map((l) => {
      const task = tasks.find((t) => t.contacts.some((c) => c.contactId === l.contact.id));
      return {
        ...l,
        stageEnteredAt: iso(l.stageEnteredAt),
        lastTouchAt: iso(l.lastTouchAt),
        createdAt: iso(l.createdAt),
        contact: { id: l.contact.id, name: fullName(l.contact), jobTitle: l.contact.jobTitle, email: l.contact.email, phone: l.contact.mobile ?? l.contact.phone, timeZone: l.contact.timeZone ?? l.company?.timeZone ?? null },
        next: task ? { label: task.title ?? "Task", at: iso(task.dueAt) } : null,
      };
    }),
    total,
    page,
    counts: {
      all: byStage.reduce((n, g) => n + g._count._all, 0),
      stale,
      ...Object.fromEntries(LEAD_STAGE_NAMES.map((s) => [s, byStage.find((x) => x.stage === s)?._count._all ?? 0])),
    } as Record<string, number>,
    view,
    filters: { stage, owner, label: sp.label ?? "", q },
    users: users as UserLite[],
    currentUserId: userId,
    hasLeads: hasLeads > 0,
    uncreated,
  };
}

export type LeadsData = Awaited<ReturnType<typeof loadLeads>>;
export type LeadRow = LeadsData["rows"][number];
