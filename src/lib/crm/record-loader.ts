import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { companyCampaigns } from "./campaigns";
import { loadQueryContext } from "./context";
import { PROVIDERS, isConfigured } from "./integrations";
import { OBJECT_LABELS } from "./defaults";
import { companyEmailList } from "./company-emails";
import { getPropertyGroups } from "./properties";
import type { LayoutConfig, RecordActivity } from "./record-types";
import { recordSegments } from "./segments";
import type { CrmObject, PropOption, UserLite } from "./types";

export const collapsedKey = (object: CrmObject) => `record:${object}:collapsed`;
export const keyInfoKey = (object: CrmObject) => `record:${object}:keyInfo`;
export const followKey = (object: CrmObject, id: string) => `follow:${object}:${id}`;

const ACTIVITY_LIMIT = 500;

function iso(d: Date | null | undefined) {
  return d ? d.toISOString() : null;
}

function serialize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toNumber();
  return v;
}

/** The layout for this user: their team's layout if one exists, otherwise the object's default. */
async function resolveLayout(object: CrmObject, userId: string, groups: { name: string; label: string }[]): Promise<{ name: string; config: LayoutConfig }> {
  const teamIds = (await db.teamMember.findMany({ where: { userId }, select: { teamId: true } })).map((t) => t.teamId);
  const layouts = await db.recordLayout.findMany({ where: { objectType: object }, orderBy: { createdAt: "asc" } });
  const layout = layouts.find((l) => l.teamId && teamIds.includes(l.teamId)) ?? layouts.find((l) => l.isDefault) ?? layouts[0];
  if (layout) return { name: layout.name, config: layout.config as unknown as LayoutConfig };
  // No stored layout: one card per property group
  return {
    name: "Default",
    config: {
      left: { keyInfo: ["ownerId", "lifecycleStage", "leadStatus"], cards: groups.map((g) => ({ id: g.name, title: g.label, group: g.name })), quickActions: ["note", "email", "call", "task", "meeting", "more"] },
      center: { tabs: [{ id: "overview", label: "Overview", cards: [] }, { id: "activities", label: "Activities", cards: [] }] },
      right: { cards: [{ id: "segments", kind: "segments", limit: 5 }] },
    } satisfies LayoutConfig,
  };
}

const activityInclude = {
  contacts: { select: { contact: { select: { id: true, firstName: true, lastName: true, email: true } } } },
  companies: { select: { company: { select: { id: true, name: true } } } },
  targetContact: { select: { id: true, firstName: true, lastName: true, email: true } },
  campaign: { select: { id: true, name: true } },
} satisfies Prisma.ActivityInclude;

type ActivityRow = Prisma.ActivityGetPayload<{ include: typeof activityInclude }>;

export function toRecordActivity(a: ActivityRow): RecordActivity {
  return {
    id: a.id,
    type: a.type,
    occurredAt: a.occurredAt.toISOString(),
    title: a.title,
    body: a.body,
    ownerId: a.ownerId,
    assigneeId: a.assigneeId,
    phoneNumberId: a.phoneNumberId,
    dialedNumber: a.dialedNumber,
    callPath: a.callPath,
    callResult: a.callResult,
    gatekeeperType: a.gatekeeperType,
    durationSec: a.durationSec,
    targetContact: a.targetContact ? { id: a.targetContact.id, name: fullName(a.targetContact) } : null,
    subject: a.subject,
    emailTo: a.emailTo,
    emailCc: a.emailCc,
    emailDirection: a.emailDirection,
    dueAt: iso(a.dueAt),
    taskType: a.taskType,
    priority: a.priority,
    taskStatus: a.taskStatus,
    completedAt: iso(a.completedAt),
    startAt: iso(a.startAt),
    endAt: iso(a.endAt),
    attendees: a.attendees,
    location: a.location,
    meetingType: a.meetingType,
    meetingOutcome: a.meetingOutcome,
    systemData: (a.systemData as RecordActivity["systemData"]) ?? null,
    contacts: a.contacts.map((c) => ({ id: c.contact.id, name: fullName(c.contact) })),
    companies: a.companies.map((c) => ({ id: c.company.id, name: c.company.name })),
    campaign: a.campaign,
  };
}

export async function loadRecord(object: CrmObject, id: string, userId: string) {
  const record =
    object === "CONTACT"
      ? await db.contact.findFirst({ where: { id, deletedAt: null } })
      : object === "COMPANY"
        ? await db.company.findFirst({ where: { id, deletedAt: null } })
        : null;
  if (!record) return null;

  const [ctx, groups, users, optionLists, followUpRules, labels, uiState, me, settings] = await Promise.all([
    loadQueryContext(userId),
    getPropertyGroups(object),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.optionList.findMany(),
    db.followUpRule.findMany({ where: { isActive: true }, select: { callResult: true, taskTitle: true, taskType: true, dueInDays: true } }),
    db.associationLabel.findMany({ where: { fromObject: "CONTACT", toObject: "COMPANY" }, orderBy: { order: "asc" }, select: { label: true } }),
    db.userUiState.findMany({ where: { userId, key: { in: [collapsedKey(object), keyInfoKey(object), followKey(object, id)] } } }),
    db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true, permissions: true } } } }),
    db.workspaceSettings.findUnique({ where: { id: "workspace" }, select: { aiEnabled: true } }),
  ]);
  const defs = ctx.defs[object];
  const layout = await resolveLayout(object, userId, groups);
  const ui = new Map(uiState.map((s) => [s.key, s.value]));

  // Property values: typed columns + custom jsonb, with dates as ISO strings
  const raw = record as unknown as Record<string, unknown> & { properties: Record<string, unknown> };
  const values: Record<string, unknown> = {};
  for (const d of defs) if (!d.isVirtual) values[d.name] = serialize(d.isBuiltIn ? raw[d.name] : raw.properties?.[d.name]);

  let header: { name: string; subtitle: string | null; email: string | null; domain: string | null; phone: string | null; timeZone: string | null; primaryCompany: { id: string; name: string } | null };
  let companies: { id: string; name: string; domain: string | null; phone: string | null; isPrimary: boolean; labels: string[] }[] = [];
  let contacts: { id: string; name: string; jobTitle: string | null; email: string | null; inDbnd: string | null; crtCount: number; timeZone: string | null; phone: string | null; mobile: string | null; labels: string[] }[] = [];
  let activityWhere: Prisma.ActivityWhereInput;
  let phoneWhere: Prisma.PhoneNumberWhereInput;
  let dealWhere: Prisma.DealWhereInput;
  let companyEmails: string[] = [];
  let industry: string | null = null;
  let technologies: string[] = [];

  if (object === "CONTACT") {
    const c = record as Prisma.ContactGetPayload<object>;
    const links = await db.contactCompany.findMany({
      where: { contactId: id, company: { deletedAt: null } },
      include: { company: { select: { id: true, name: true, domain: true, phone: true, timeZone: true, industry: true, technologies: true } } },
      orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }],
    });
    companies = links.map((l) => ({ id: l.company.id, name: l.company.name, domain: l.company.domain, phone: l.company.phone, isPrimary: l.isPrimary, labels: l.labels }));
    const primary = links.find((l) => l.isPrimary)?.company ?? null;
    values.primaryCompany = primary?.name ?? null;
    header = {
      name: fullName(c),
      subtitle: c.jobTitle ? `${c.jobTitle}${primary ? ` at ${primary.name}` : ""}` : primary ? primary.name : null,
      email: c.email,
      domain: null,
      phone: c.phone,
      timeZone: c.timeZone ?? primary?.timeZone ?? null,
      primaryCompany: primary ? { id: primary.id, name: primary.name } : null,
    };
    activityWhere = { deletedAt: null, contacts: { some: { contactId: id } } };
    phoneWhere = { OR: [{ contactId: id }, ...(primary ? [{ companyId: primary.id, contactId: null }] : [])] };
    dealWhere = { deletedAt: null, contacts: { some: { contactId: id } } };
    industry = primary?.industry ?? null;
    technologies = primary?.technologies ?? [];
  } else {
    const co = record as Prisma.CompanyGetPayload<object>;
    const links = await db.contactCompany.findMany({
      where: { companyId: id, contact: { deletedAt: null } },
      include: { contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true, inDbnd: true, crtCount: true, timeZone: true, phone: true, mobile: true } } },
      orderBy: { createdAt: "asc" },
    });
    contacts = links.map((l) => ({ id: l.contact.id, name: fullName(l.contact), jobTitle: l.contact.jobTitle, email: l.contact.email, inDbnd: l.contact.inDbnd, crtCount: l.contact.crtCount, timeZone: l.contact.timeZone ?? co.timeZone, phone: l.contact.phone, mobile: l.contact.mobile, labels: l.labels }));
    values.targetCount = contacts.length;
    companyEmails = companyEmailList(co);
    header = { name: co.name, subtitle: co.industry, email: co.email, domain: co.domain, phone: co.phone, timeZone: co.timeZone, primaryCompany: null };
    // Company timelines include its contacts' activities (but not their system events)
    activityWhere = {
      deletedAt: null,
      OR: [{ companies: { some: { companyId: id } } }, { type: { not: "SYSTEM" }, contacts: { some: { contact: { companies: { some: { companyId: id } } } } } }],
    };
    phoneWhere = { companyId: id };
    dealWhere = { deletedAt: null, companies: { some: { companyId: id } } };
    industry = co.industry;
    technologies = co.technologies;
  }

  // Company-level tracking (for a contact: its primary company's)
  const journeyCompanyId = object === "COMPANY" ? id : (header.primaryCompany?.id ?? null);
  const [journeyCompany, journeyEvents, signals, campaigns, integrationRows] = await Promise.all([
    journeyCompanyId ? db.company.findUnique({ where: { id: journeyCompanyId }, select: { id: true, name: true, leadState: true, leadStateAt: true } }) : null,
    journeyCompanyId ? db.journeyEvent.findMany({ where: { companyId: journeyCompanyId }, orderBy: { at: "desc" }, take: 100 }) : [],
    object === "COMPANY" ? db.buyingSignal.findMany({ where: { companyId: id }, orderBy: { detectedAt: "desc" } }) : [],
    companyCampaigns(journeyCompanyId ? [journeyCompanyId] : []),
    object === "COMPANY" ? db.integration.findMany() : [],
  ]);
  const campaignNames = new Map(
    (await db.campaign.findMany({ where: { id: { in: journeyEvents.map((e) => e.campaignId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })).map((c) => [c.id, c.name]),
  );

  const [activities, phones, deals, caseStudies, segments] = await Promise.all([
    db.activity.findMany({ where: activityWhere, include: activityInclude, orderBy: { occurredAt: "desc" }, take: ACTIVITY_LIMIT }),
    db.phoneNumber.findMany({ where: phoneWhere, include: { contact: { select: { firstName: true, lastName: true, email: true } } }, orderBy: { createdAt: "asc" } }),
    db.deal.findMany({ where: dealWhere, include: { stage: { select: { name: true, color: true } } }, orderBy: { createdAt: "desc" } }),
    industry || technologies.length
      ? db.caseStudy.findMany({ where: { OR: [...(industry ? [{ industry }] : []), ...(technologies.length ? [{ technologies: { hasSome: technologies } }] : [])] }, take: 10 })
      : Promise.resolve([]),
    recordSegments(object, id, userId, ctx),
  ]);

  // Most relevant projects first: same industry and shared technologies
  const scored = caseStudies
    .map((cs) => ({ cs, score: (cs.industry === industry ? 2 : 0) + cs.technologies.filter((t) => technologies.includes(t)).length }))
    .sort((a, b) => b.score - a.score)
    .map(({ cs }) => ({ id: cs.id, title: cs.title, industry: cs.industry, technologies: cs.technologies, summary: cs.summary, url: cs.url, matches: cs.technologies.filter((t) => technologies.includes(t)) }));

  await db.recentView.upsert({
    where: { userId_objectType_recordId: { userId, objectType: object, recordId: id } },
    create: { userId, objectType: object, recordId: id },
    update: { viewedAt: new Date() },
  });

  const perms = (me?.role?.permissions ?? {}) as { contacts?: { delete?: boolean } };
  const options = (key: string) => ((optionLists.find((l) => l.key === key)?.options as PropOption[] | null) ?? []).filter((o) => !o.archived);

  return {
    object,
    id,
    labels: OBJECT_LABELS[object],
    header,
    values,
    defs,
    groups,
    associatedDefs: object === "CONTACT" ? ctx.defs.COMPANY : ctx.defs.CONTACT,
    layout,
    keyInfo: (ui.get(keyInfoKey(object)) as string[] | undefined) ?? layout.config.left.keyInfo,
    keyInfoIsCustom: ui.has(keyInfoKey(object)),
    collapsed: (ui.get(collapsedKey(object)) as string[] | undefined) ?? [],
    isFollowing: ui.get(followKey(object, id)) === true,
    canDelete: perms.contacts?.delete !== false,
    aiEnabled: settings?.aiEnabled ?? false,
    users: users as UserLite[],
    currentUserId: userId,
    activities: activities.map(toRecordActivity),
    activitiesTruncated: activities.length === ACTIVITY_LIMIT,
    companies,
    contacts,
    companyEmails,
    phones: phones.map((p) => ({
      id: p.id,
      number: p.number,
      extension: p.extension,
      type: p.type,
      ivrPath: p.ivrPath,
      status: p.status,
      lastDialedAt: iso(p.lastDialedAt),
      source: p.contactId ? ("contact" as const) : ("company" as const),
      notes: p.notes,
      contactId: p.contactId,
      contactName: p.contact ? fullName(p.contact) : null,
    })),
    deals: deals.map((d) => ({ id: d.id, name: d.name, amount: d.amount?.toNumber() ?? null, closeDate: iso(d.closeDate), stage: d.stage.name, stageColor: d.stage.color })),
    caseStudies: scored,
    segments,
    options: {
      callResult: options("callResult"),
      callPath: options("callPath"),
      gatekeeperType: options("gatekeeperType"),
      taskType: options("taskType"),
      taskPriority: options("taskPriority"),
      meetingType: options("meetingType"),
      meetingOutcome: options("meetingOutcome"),
      phoneType: options("phoneType"),
      phoneStatus: options("phoneStatus"),
    },
    followUpRules,
    associationLabels: labels.map((l) => l.label).filter((l) => l !== "Primary"),
    journey: journeyCompany
      ? {
          companyId: journeyCompany.id,
          companyName: journeyCompany.name,
          stage: journeyCompany.leadState,
          stageAt: iso(journeyCompany.leadStateAt),
          options: ctx.defs.COMPANY.find((d) => d.name === "leadState")?.options ?? [],
          events: journeyEvents.map((e) => ({
            id: e.id,
            from: e.fromStage,
            to: e.toStage,
            at: e.at.toISOString(),
            userId: e.userId,
            source: e.source,
            reason: e.reason,
            campaign: e.campaignId ? (campaignNames.get(e.campaignId) ?? null) : null,
          })),
        }
      : null,
    signals: signals.map((s) => ({
      id: s.id,
      type: s.type,
      title: s.title,
      detail: s.detail,
      url: s.url,
      source: s.source,
      strength: s.strength,
      detectedAt: s.detectedAt.toISOString(),
      expiresAt: iso(s.expiresAt),
    })),
    campaigns,
    integrations: PROVIDERS.filter((p) => p.kind === "api").map((p) => ({
      id: p.id,
      name: p.name,
      configured: isConfigured(p),
      enabled: integrationRows.find((r) => r.provider === p.id)?.enabled ?? false,
    })),
    signalOptions: { type: options("signalType"), strength: options("signalStrength"), source: options("signalSource") },
  };
}

export type RecordData = NonNullable<Awaited<ReturnType<typeof loadRecord>>>;
