import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { OPEN_STATUSES, compareQueue, inBusinessHours, queueBucket } from "./calling-queue";
import { parseSettings, personDone } from "./campaigns";
import { getPropDefs } from "./properties";
import type { PropOption, UserLite } from "./types";

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Which members a caller works: "me" (default), "unassigned", "all", or a user id. */
function callerWhere(caller: string, userId: string): Prisma.CampaignCompanyWhereInput {
  if (caller === "all") return {};
  if (caller === "unassigned") return { assignedToId: null };
  return { assignedToId: caller === "me" ? userId : caller };
}

/** Active campaigns with how much calling is waiting, for me and for everyone. */
export async function loadQueueIndex(userId: string) {
  const campaigns = await db.campaign.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, name: true, type: true, endDate: true, owner: { select: { name: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const members = await db.campaignCompany.findMany({
    where: { campaignId: { in: campaigns.map((c) => c.id) }, removedAt: null, status: { in: OPEN_STATUSES }, company: { deletedAt: null } },
    select: { campaignId: true, assignedToId: true, attempts: true, nextActionAt: true, lastCallAt: true, addedAt: true, company: { select: { timeZone: true } } },
  });
  // Research the team sent back to me that I haven't opened yet
  const researchBack = await db.researchRequest.findMany({
    where: { requestedById: userId, status: "Sent back", seenAt: null },
    include: { company: { select: { name: true } }, researcher: { select: { name: true } } },
    orderBy: { resolvedAt: "desc" },
    take: 20,
  });
  const now = Date.now();
  return {
    campaigns: campaigns.map((c) => {
      const all = members.filter((m) => m.campaignId === c.id).map((m) => ({ ...m, nextActionAt: iso(m.nextActionAt), lastCallAt: iso(m.lastCallAt), addedAt: m.addedAt.toISOString() }));
      const mine = all.filter((m) => m.assignedToId === userId);
      const ready = (list: typeof all) => list.filter((m) => queueBucket(m, now) !== "scheduled").length;
      return {
        id: c.id,
        name: c.name,
        type: c.type,
        owner: c.owner?.name ?? null,
        endDate: iso(c.endDate),
        open: all.length,
        ready: ready(all),
        mine: mine.length,
        mineReady: ready(mine),
        mineDue: mine.filter((m) => queueBucket(m, now) === "due").length,
        unassigned: all.filter((m) => !m.assignedToId).length,
        inHoursNow: all.filter((m) => inBusinessHours(m.company.timeZone) !== false).length,
      };
    }),
    researchBack: researchBack.map((r) => ({
      id: r.id,
      companyId: r.companyId,
      company: r.company.name,
      campaignId: r.campaignId,
      kind: r.kind,
      result: r.result,
      researcher: r.researcher?.name ?? null,
      resolvedAt: iso(r.resolvedAt),
    })),
  };
}

export type QueueIndexData = Awaited<ReturnType<typeof loadQueueIndex>>;

export interface QueueSearchParams {
  caller?: string;
  id?: string;
  hours?: string;
}

async function optionList(key: string) {
  const l = await db.optionList.findUnique({ where: { key } });
  return ((l?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);
}

export async function loadQueue(campaignId: string, userId: string, sp: QueueSearchParams) {
  const campaign = await db.campaign.findUnique({ where: { id: campaignId } });
  if (!campaign) return null;

  // Default to my companies when I have any, otherwise everyone's
  const mineCount = await db.campaignCompany.count({ where: { campaignId, removedAt: null, assignedToId: userId, status: { in: OPEN_STATUSES } } });
  const caller = sp.caller || (mineCount ? "me" : "all");
  const hoursOnly = sp.hours === "1";

  const rows = await db.campaignCompany.findMany({
    where: { campaignId, removedAt: null, status: { in: OPEN_STATUSES }, company: { deletedAt: null }, ...callerWhere(caller, userId) },
    select: {
      companyId: true,
      status: true,
      attempts: true,
      connects: true,
      lastResult: true,
      lastCallAt: true,
      nextActionAt: true,
      addedAt: true,
      assignedTo: { select: { id: true, name: true } },
      company: { select: { name: true, domain: true, timeZone: true, leadState: true } },
    },
  });
  // Research the callers asked for: still open, or sent back and not read yet
  const requests = await db.researchRequest.findMany({
    where: { companyId: { in: rows.map((m) => m.companyId) }, OR: [{ status: { in: ["Open", "In progress"] } }, { status: "Sent back", seenAt: null }] },
    select: { companyId: true, status: true },
  });
  const now = Date.now();
  const queue = rows
    .map((m) => ({
      companyId: m.companyId,
      name: m.company.name,
      domain: m.company.domain,
      timeZone: m.company.timeZone,
      leadState: m.company.leadState,
      status: m.status,
      attempts: m.attempts,
      connects: m.connects,
      lastResult: m.lastResult,
      lastCallAt: iso(m.lastCallAt),
      nextActionAt: iso(m.nextActionAt),
      addedAt: m.addedAt.toISOString(),
      assignedTo: m.assignedTo,
      inHours: inBusinessHours(m.company.timeZone),
      researchOpen: requests.some((r) => r.companyId === m.companyId && r.status !== "Sent back"),
      researchBack: requests.some((r) => r.companyId === m.companyId && r.status === "Sent back"),
    }))
    .filter((m) => !hoursOnly || m.inHours !== false)
    .sort((a, b) => compareQueue(a, b, now))
    .map((m) => ({ ...m, bucket: queueBucket(m, now) }));

  const currentId = queue.some((q) => q.companyId === sp.id) ? sp.id! : queue[0]?.companyId;
  const [users, current, callResults, callPaths, gatekeeperTypes, followUpRules, companyDefs, phoneTypes, phoneStatuses] = await Promise.all([
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    currentId ? loadCompany(currentId, campaignId, parseSettings(campaign.settings).maxAttempts) : null,
    optionList("callResult"),
    optionList("callPath"),
    optionList("gatekeeperType"),
    db.followUpRule.findMany({ where: { isActive: true }, select: { callResult: true, taskTitle: true, taskType: true, dueInDays: true } }),
    getPropDefs("COMPANY"),
    optionList("phoneType"),
    optionList("phoneStatus"),
  ]);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      type: campaign.type,
      audience: campaign.audience as "COMPANY" | "CONTACT",
      pitch: campaign.pitch,
      status: campaign.status,
      maxAttempts: parseSettings(campaign.settings).maxAttempts,
    },
    caller,
    hoursOnly,
    queue,
    current,
    users: users as UserLite[],
    currentUserId: userId,
    options: { callResult: callResults, callPath: callPaths, gatekeeperType: gatekeeperTypes, phoneType: phoneTypes, phoneStatus: phoneStatuses },
    journeyOptions: companyDefs.find((d) => d.name === "leadState")?.options ?? [],
    followUpRules,
  };
}

/** Everything a caller needs on screen for one company. */
async function loadCompany(companyId: string, campaignId: string, maxAttempts: number | null) {
  const [company, links, phones, calls, tasks, signals, member, research, notes, targets] = await Promise.all([
    db.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { id: true, name: true, domain: true, phone: true, linkedinUrl: true, timeZone: true, city: true, state: true, country: true, industry: true, employees: true, description: true, pitchNotes: true, leadState: true, callStatus: true, crtCount: true },
    }),
    db.contactCompany.findMany({
      where: { companyId, contact: { deletedAt: null } },
      include: {
        contact: {
          select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, phone: true, mobile: true, inDbnd: true, crtCount: true, callStatus: true, doNotCall: true, timeZone: true, leadStatus: true },
        },
      },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    }),
    db.phoneNumber.findMany({ where: { OR: [{ companyId }, { contact: { companies: { some: { companyId } } } }] }, orderBy: { createdAt: "asc" } }),
    db.activity.findMany({
      where: {
        type: "CALL",
        deletedAt: null,
        OR: [{ companies: { some: { companyId } } }, { contacts: { some: { contact: { companies: { some: { companyId } } } } } }],
      },
      include: { targetContact: { select: { firstName: true, lastName: true, email: true } }, owner: { select: { name: true } }, campaign: { select: { id: true, name: true } } },
      orderBy: { occurredAt: "desc" },
      take: 50,
    }),
    db.activity.findMany({
      where: { type: "TASK", deletedAt: null, taskStatus: { not: "COMPLETED" }, companies: { some: { companyId } } },
      select: { id: true, title: true, dueAt: true, taskType: true },
      orderBy: { dueAt: "asc" },
      take: 5,
    }),
    db.buyingSignal.findMany({ where: { companyId }, orderBy: { detectedAt: "desc" }, take: 5 }),
    db.campaignCompany.findUnique({ where: { campaignId_companyId: { campaignId, companyId } } }),
    db.researchRequest.findMany({
      where: { companyId, status: { not: "Cancelled" } },
      include: { requestedBy: { select: { name: true } }, researcher: { select: { name: true } }, contact: { select: { firstName: true, lastName: true, email: true } } },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    // Notes written on the company or its people (not part of a call)
    db.activity.findMany({
      where: {
        type: "NOTE",
        deletedAt: null,
        OR: [{ companies: { some: { companyId } } }, { contacts: { some: { contact: { companies: { some: { companyId } } } } } }],
      },
      include: { owner: { select: { name: true } }, contacts: { select: { contact: { select: { firstName: true, lastName: true, email: true } } }, take: 1 } },
      orderBy: { occurredAt: "desc" },
      take: 20,
    }),
    // Contact campaigns: the people to call here
    db.campaignContact.findMany({ where: { campaignId, companyId, removedAt: null }, select: { contactId: true, status: true, attempts: true, lastResult: true } }),
  ]);
  const contactName = new Map(links.map((l) => [l.contact.id, fullName(l.contact)]));

  return {
    ...company,
    contacts: links.map((l) => ({
      id: l.contact.id,
      name: fullName(l.contact),
      firstName: l.contact.firstName,
      lastName: l.contact.lastName,
      jobTitle: l.contact.jobTitle,
      email: l.contact.email,
      phone: l.contact.phone,
      mobile: l.contact.mobile,
      inDbnd: l.contact.inDbnd,
      crtCount: l.contact.crtCount,
      callStatus: l.contact.callStatus,
      leadStatus: l.contact.leadStatus,
      doNotCall: l.contact.doNotCall,
      labels: l.labels,
      isPrimary: l.isPrimary,
      // Contact campaigns: whether this person is on the list, and how far they got
      target: (() => {
        const t = targets.find((x) => x.contactId === l.contact.id);
        return t ? { status: t.status, attempts: t.attempts, lastResult: t.lastResult, done: personDone(t, maxAttempts) } : null;
      })(),
    })),
    phones: phones.map((p) => ({
      id: p.id,
      number: p.number,
      extension: p.extension,
      type: p.type,
      ivrPath: p.ivrPath,
      status: p.status,
      lastDialedAt: iso(p.lastDialedAt),
      contactId: p.contactId,
      contactName: p.contactId ? (contactName.get(p.contactId) ?? null) : null,
      notes: p.notes,
    })),
    calls: calls.map((a) => ({
      id: a.id,
      at: a.occurredAt.toISOString(),
      result: a.callResult,
      path: a.callPath,
      gatekeeperType: a.gatekeeperType,
      number: a.dialedNumber,
      durationSec: a.durationSec,
      body: a.body,
      contact: a.targetContact ? fullName(a.targetContact) : null,
      contactId: a.targetContactId,
      by: a.owner?.name ?? null,
      campaign: a.campaign,
      thisCampaign: a.campaignId === campaignId,
    })),
    tasks: tasks.map((t) => ({ ...t, dueAt: iso(t.dueAt) })),
    signals: signals.map((s) => ({ id: s.id, type: s.type, title: s.title, strength: s.strength, detectedAt: s.detectedAt.toISOString() })),
    notes: notes.map((n) => ({ id: n.id, at: n.occurredAt.toISOString(), body: n.body, by: n.owner?.name ?? null, contact: n.contacts[0] ? fullName(n.contacts[0].contact) : null })),
    // Targeted people no longer linked to this company (moved on)
    movedTargets: targets.filter((t) => !links.some((l) => l.contact.id === t.contactId)).length,
    research: research.map((r) => ({
      id: r.id,
      kind: r.kind,
      note: r.note,
      status: r.status,
      result: r.result,
      contact: r.contact ? fullName(r.contact) : null,
      requestedBy: r.requestedBy?.name ?? null,
      researcher: r.researcher?.name ?? null,
      createdAt: r.createdAt.toISOString(),
      resolvedAt: iso(r.resolvedAt),
      seen: !!r.seenAt,
    })),
    member: member ? { status: member.status, attempts: member.attempts, connects: member.connects, nextActionAt: iso(member.nextActionAt), notes: member.notes } : null,
  };
}

export type QueueData = NonNullable<Awaited<ReturnType<typeof loadQueue>>>;
export type QueueCompany = NonNullable<QueueData["current"]>;
