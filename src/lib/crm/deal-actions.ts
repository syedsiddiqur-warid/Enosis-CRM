"use server";

// Deals: create, edit, move through the pipeline, notes, and lead qualification.
// Opening a deal makes its company an Opportunity and its people Opportunities; winning makes them Customers.
import { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { DEAL_TYPES } from "./deals";
import { STAGE } from "./journey";
import { leadAudit, syncLifecycle } from "./lead-sync";
import { LEAD_STATUS_FOR_STAGE, OPEN_LEAD_STAGES } from "./leads";
import { advanceJourney } from "./record-writes";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });
const json = (v: unknown) => v as Prisma.InputJsonValue;

export interface DealInput {
  name: string;
  pipelineId?: string;
  stageId?: string;
  amount?: number | null;
  closeDate?: string | null;
  ownerId?: string | null;
  dealType?: string | null;
  sourceCampaign?: string | null;
  companyId?: string | null;
  contactIds?: string[];
  /** Qualify this lead into the new deal */
  leadId?: string | null;
}

function revalidateDeals(id?: string, companyIds: string[] = [], contactIds: string[] = []) {
  revalidatePath("/deals", "layout");
  revalidatePath("/leads");
  if (id) revalidatePath(`/deals/${id}`);
  for (const c of companyIds) revalidatePath(`/companies/${c}`);
  for (const c of contactIds) revalidatePath(`/contacts/${c}`);
}

const amountOf = (v: number | null | undefined) => {
  if (v === null || v === undefined || (typeof v === "number" && Number.isNaN(v))) return null;
  if (v < 0) throw new Error("Amount can't be negative");
  return new Prisma.Decimal(v);
};
const dateOf = (v: string | null | undefined) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new Error("Invalid close date");
  return d;
};

/** Timeline event on the deal (and optionally its company and people). */
async function dealEvent(dealId: string, data: Record<string, unknown>, userId: string | null, links: { companyIds?: string[]; contactIds?: string[] } = {}) {
  await db.activity.create({
    data: {
      type: "SYSTEM",
      ownerId: userId,
      systemData: json(data),
      deals: { create: { dealId } },
      companies: { create: (links.companyIds ?? []).map((companyId) => ({ companyId })) },
      contacts: { create: (links.contactIds ?? []).map((contactId) => ({ contactId })) },
    },
  });
}

/** What a deal's stage means for its company and people. */
async function followStage(dealId: string, userId: string) {
  const deal = await db.deal.findUniqueOrThrow({
    where: { id: dealId },
    select: { stage: { select: { stageType: true } }, companies: { select: { companyId: true } }, contacts: { select: { contactId: true } } },
  });
  const won = deal.stage.stageType === "WON";
  if (deal.stage.stageType === "LOST") return;
  for (const { companyId } of deal.companies) await advanceJourney(companyId, won ? STAGE.customer : STAGE.opportunity, userId, { source: "deal", reason: won ? "Deal won" : "Deal opened" });
  await syncLifecycle(
    deal.contacts.map((c) => c.contactId),
    { lifecycle: won ? "Customer" : "Opportunity", leadStatus: "Open Deal" },
    userId,
  );
}

export async function createDeal(input: DealInput): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    const name = input.name?.trim();
    if (!name) throw new Error("Give the deal a name");
    const pipeline = input.pipelineId
      ? await db.pipeline.findUnique({ where: { id: input.pipelineId }, include: { stages: { orderBy: { order: "asc" } } } })
      : await db.pipeline.findFirst({ where: { objectType: "DEAL" }, orderBy: { order: "asc" }, include: { stages: { orderBy: { order: "asc" } } } });
    if (!pipeline) throw new Error("Set up a deal pipeline first");
    const stage = input.stageId ? pipeline.stages.find((s) => s.id === input.stageId) : pipeline.stages.find((s) => s.stageType === "OPEN");
    if (!stage) throw new Error("Pick a stage in this pipeline");
    if (input.dealType && !(DEAL_TYPES as readonly string[]).includes(input.dealType)) throw new Error("Unknown deal type");

    const lead = input.leadId ? await db.lead.findUnique({ where: { id: input.leadId } }) : null;
    if (input.leadId && (!lead || lead.deletedAt)) throw new Error("That lead no longer exists");
    const companyId = input.companyId || lead?.companyId || null;
    const contactIds = [...new Set([...(input.contactIds ?? []), ...(lead ? [lead.contactId] : [])])];
    if (!companyId && !contactIds.length) throw new Error("Link the deal to a company or a person");

    const deal = await db.deal.create({
      data: {
        name,
        pipelineId: pipeline.id,
        stageId: stage.id,
        amount: amountOf(input.amount),
        closeDate: dateOf(input.closeDate),
        ownerId: input.ownerId === undefined ? user.id : input.ownerId,
        dealType: input.dealType || null,
        sourceCampaign: input.sourceCampaign?.trim() || null,
        closedAt: stage.stageType === "OPEN" ? null : new Date(),
        companies: companyId ? { create: { companyId, isPrimary: true } } : undefined,
        contacts: { create: contactIds.map((contactId) => ({ contactId })) },
      },
    });
    await db.auditLog.create({ data: { objectType: "DEAL", recordId: deal.id, action: "create", changes: json({ stage: { from: null, to: stage.name } }), userId: user.id } });
    await dealEvent(deal.id, { kind: "deal_created", label: name, to: stage.name }, user.id, { companyIds: companyId ? [companyId] : [], contactIds });

    // The lead it came from (and any other open lead for these people) is now qualified
    const open = await db.lead.findMany({ where: { deletedAt: null, OR: [...(lead ? [{ id: lead.id }] : []), { contactId: { in: contactIds }, stage: { in: OPEN_LEAD_STAGES } }] } });
    for (const l of open) {
      await db.lead.update({ where: { id: l.id }, data: { stage: "Qualified", stageEnteredAt: new Date(), closedAt: new Date(), dealId: deal.id } });
      await leadAudit(l.id, { stage: { from: l.stage, to: "Qualified" }, dealId: { from: l.dealId, to: deal.id } }, user.id);
    }
    await syncLifecycle(contactIds, { lifecycle: "SQL", leadStatus: LEAD_STATUS_FOR_STAGE.Qualified }, user.id);
    await followStage(deal.id, user.id);

    revalidateDeals(deal.id, companyId ? [companyId] : [], contactIds);
    return { ok: true, data: { id: deal.id } };
  } catch (e) {
    return fail(e);
  }
}

type Editable = "name" | "amount" | "closeDate" | "ownerId" | "dealType" | "sourceCampaign";
type DealPatch = Partial<Pick<DealInput, Editable>>;

export async function updateDeal(id: string, patch: DealPatch): Promise<Result> {
  try {
    const user = await requireUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id } });
    const data: Prisma.DealUncheckedUpdateInput = {};
    const changes: Record<string, { from: unknown; to: unknown }> = {};
    const set = (key: Editable, value: unknown, before: unknown) => {
      const a = before instanceof Prisma.Decimal ? before.toNumber() : before instanceof Date ? before.toISOString() : (before ?? null);
      const b = value instanceof Prisma.Decimal ? value.toNumber() : value instanceof Date ? value.toISOString() : (value ?? null);
      if (a === b) return;
      (data as Record<string, unknown>)[key] = value;
      changes[key] = { from: a, to: b };
    };
    if ("name" in patch) {
      if (!patch.name?.trim()) throw new Error("Give the deal a name");
      set("name", patch.name.trim(), deal.name);
    }
    if ("amount" in patch) set("amount", amountOf(patch.amount), deal.amount);
    if ("closeDate" in patch) set("closeDate", dateOf(patch.closeDate), deal.closeDate);
    if ("ownerId" in patch) {
      if (patch.ownerId && !(await db.user.count({ where: { id: patch.ownerId } }))) throw new Error("Unknown user");
      set("ownerId", patch.ownerId || null, deal.ownerId);
    }
    if ("dealType" in patch) {
      if (patch.dealType && !(DEAL_TYPES as readonly string[]).includes(patch.dealType)) throw new Error("Unknown deal type");
      set("dealType", patch.dealType || null, deal.dealType);
    }
    if ("sourceCampaign" in patch) set("sourceCampaign", patch.sourceCampaign?.trim() || null, deal.sourceCampaign);
    if (!Object.keys(changes).length) return { ok: true };
    await db.deal.update({ where: { id }, data });
    await db.auditLog.create({ data: { objectType: "DEAL", recordId: id, action: "update", changes: json(changes), userId: user.id } });
    revalidateDeals(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Move a deal to another stage of its pipeline. Lost deals need a reason. */
export async function moveDeal(id: string, stageId: string, lostReason?: string): Promise<Result> {
  try {
    const user = await requireUser();
    const deal = await db.deal.findUniqueOrThrow({ where: { id }, include: { stage: true, companies: { select: { companyId: true } }, contacts: { select: { contactId: true } } } });
    if (deal.deletedAt) throw new Error("This deal was deleted");
    if (deal.stageId === stageId) return { ok: true };
    const stage = await db.pipelineStage.findFirst({ where: { id: stageId, pipelineId: deal.pipelineId } });
    if (!stage) throw new Error("That stage isn't in this deal's pipeline");
    const reason = lostReason?.trim() || null;
    if (stage.stageType === "LOST" && !reason) throw new Error("Say why the deal was lost");
    await db.deal.update({
      where: { id },
      data: {
        stageId,
        stageEnteredAt: new Date(),
        closedAt: stage.stageType === "OPEN" ? null : new Date(),
        lostReason: stage.stageType === "LOST" ? reason : null,
      },
    });
    await db.auditLog.create({
      data: { objectType: "DEAL", recordId: id, action: "update", changes: json({ stage: { from: deal.stage.name, to: stage.name }, ...(reason ? { lostReason: { from: deal.lostReason, to: reason } } : {}) }), userId: user.id },
    });
    const closing = stage.stageType !== "OPEN";
    await dealEvent(
      id,
      { kind: "property_change", property: "stage", label: "Deal stage", from: deal.stage.name, to: stage.name, ...(reason ? { reason } : {}) },
      user.id,
      // Won and lost show on the company and people too
      closing ? { companyIds: deal.companies.map((c) => c.companyId), contactIds: deal.contacts.map((c) => c.contactId) } : {},
    );
    await followStage(id, user.id);
    revalidateDeals(
      id,
      deal.companies.map((c) => c.companyId),
      deal.contacts.map((c) => c.contactId),
    );
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteDeals(ids: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    await db.deal.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: "DEAL" as const, recordId, action: "delete", changes: json({}), userId: user.id })) });
    revalidateDeals();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreDeals(ids: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    await db.deal.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: "DEAL" as const, recordId, action: "restore", changes: json({}), userId: user.id })) });
    revalidateDeals();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** A note on the deal, also shown on its company and people. */
export async function addDealNote(id: string, body: string): Promise<Result> {
  try {
    const user = await requireUser();
    const text = body.trim();
    if (!text) throw new Error("Write a note first");
    const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { companies: { select: { companyId: true } }, contacts: { select: { contactId: true } } } });
    await db.activity.create({
      data: {
        type: "NOTE",
        body: text,
        ownerId: user.id,
        deals: { create: { dealId: id } },
        companies: { create: deal.companies.map((c) => ({ companyId: c.companyId })) },
        contacts: { create: deal.contacts.map((c) => ({ contactId: c.contactId })) },
      },
    });
    await db.deal.update({ where: { id }, data: { lastActivityAt: new Date() } });
    revalidateDeals(id);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Add or remove a person on a deal. */
export async function setDealContact(id: string, contactId: string, linked: boolean): Promise<Result> {
  try {
    const user = await requireUser();
    if (linked) {
      await db.dealContact.upsert({ where: { dealId_contactId: { dealId: id, contactId } }, create: { dealId: id, contactId }, update: {} });
      const deal = await db.deal.findUniqueOrThrow({ where: { id }, select: { stage: { select: { stageType: true } } } });
      if (deal.stage.stageType !== "LOST") await syncLifecycle([contactId], { lifecycle: deal.stage.stageType === "WON" ? "Customer" : "Opportunity", leadStatus: "Open Deal" }, user.id);
    } else await db.dealContact.deleteMany({ where: { dealId: id, contactId } });
    revalidateDeals(id, [], [contactId]);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** People at a company, for picking who a new deal is with. */
export async function companyPeople(companyId: string) {
  await requireUser();
  const rows = await db.contactCompany.findMany({
    where: { companyId, contact: { deletedAt: null } },
    select: { isPrimary: true, contact: { select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true } } },
    orderBy: { createdAt: "asc" },
    take: 100,
  });
  return rows.map((r) => ({ id: r.contact.id, name: [r.contact.firstName, r.contact.lastName].filter(Boolean).join(" ") || r.contact.email || "Unnamed", jobTitle: r.contact.jobTitle }));
}

/** Pipelines, owners and campaigns for the create-deal form. */
export async function dealFormOptions() {
  const user = await requireUser();
  const [pipelines, users, campaigns] = await Promise.all([
    db.pipeline.findMany({ where: { objectType: "DEAL" }, orderBy: { order: "asc" }, include: { stages: { orderBy: { order: "asc" } } } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.campaign.findMany({ where: { status: { in: ["ACTIVE", "PAUSED", "COMPLETED"] } }, select: { name: true }, orderBy: { createdAt: "desc" }, take: 50 }),
  ]);
  return {
    pipelines: pipelines.map((p) => ({ id: p.id, name: p.name, stages: p.stages.map((s) => ({ id: s.id, name: s.name, stageType: s.stageType, probability: s.probability })) })),
    users,
    campaigns: campaigns.map((c) => c.name),
    currentUserId: user.id,
  };
}
