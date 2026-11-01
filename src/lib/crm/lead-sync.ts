// Server-only lead tracking shared by lead/deal actions and call logging.
// Not a "use server" module: these take a trusted userId and must never be callable from the client.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { fullName } from "@/lib/utils";
import { LEAD_STATUS_FOR_STAGE, LEAD_WORTHY_OUTCOMES, OPEN_LEAD_STAGES, leadStageForCall, type LeadStage } from "./leads";
import { getPropDefs } from "./properties";
import { applyUpdate } from "./record-writes";

const RULE = "Lead pipeline";

/** Move contacts' lifecycle stage forward (never back) and set their lead status. */
export async function syncLifecycle(contactIds: string[], change: { lifecycle?: string; leadStatus?: string }, userId: string) {
  if (!contactIds.length) return;
  const order = ((await getPropDefs("CONTACT")).find((d) => d.name === "lifecycleStage")?.options ?? []).map((o) => o.value).filter((v) => v !== "Other");
  const contacts = await db.contact.findMany({ where: { id: { in: contactIds }, deletedAt: null }, select: { id: true, lifecycleStage: true, leadStatus: true } });
  for (const c of contacts) {
    if (change.lifecycle && order.includes(change.lifecycle) && order.indexOf(change.lifecycle) > order.indexOf(c.lifecycleStage ?? "")) {
      await applyUpdate("CONTACT", c.id, "lifecycleStage", change.lifecycle, userId, { rule: RULE });
    }
    if (change.leadStatus && change.leadStatus !== c.leadStatus) await applyUpdate("CONTACT", c.id, "leadStatus", change.leadStatus, userId, { rule: RULE });
  }
}

export function leadAudit(id: string, changes: Record<string, { from: unknown; to: unknown }>, userId: string | null, action = "update") {
  return db.auditLog.create({ data: { objectType: "LEAD", recordId: id, action, changes: changes as Prisma.InputJsonValue, userId } });
}

export interface NewLead {
  ownerId?: string | null;
  stage?: LeadStage;
  leadType?: string | null;
  label?: string | null;
  source?: string | null;
  campaignId?: string | null;
}

/** Open a lead for each person who doesn't already have an open one. Returns the new lead ids. */
export async function openLeads(contactIds: string[], input: NewLead, userId: string) {
  const open = await db.lead.findMany({ where: { contactId: { in: contactIds }, deletedAt: null, stage: { in: OPEN_LEAD_STAGES } }, select: { contactId: true } });
  const skip = new Set(open.map((l) => l.contactId));
  const contacts = await db.contact.findMany({
    where: { id: { in: contactIds.filter((id) => !skip.has(id)) }, deletedAt: null },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      email: true,
      ownerId: true,
      companies: { where: { company: { deletedAt: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { company: { select: { id: true, name: true } } } },
    },
  });
  const ids: string[] = [];
  const stage = input.stage ?? "New";
  for (const c of contacts) {
    const company = c.companies[0]?.company ?? null;
    const lead = await db.lead.create({
      data: {
        name: [fullName(c), company?.name].filter(Boolean).join(" – "),
        contactId: c.id,
        companyId: company?.id ?? null,
        ownerId: input.ownerId === undefined ? (c.ownerId ?? userId) : input.ownerId,
        stage,
        leadType: input.leadType ?? "New business",
        label: input.label ?? null,
        source: input.source ?? null,
        campaignId: input.campaignId ?? null,
        createdById: userId,
      },
    });
    await leadAudit(lead.id, { stage: { from: null, to: stage } }, userId, "create");
    ids.push(lead.id);
  }
  await syncLifecycle(
    contacts.map((c) => c.id),
    { lifecycle: "Lead", leadStatus: LEAD_STATUS_FOR_STAGE[stage] },
    userId,
  );
  return ids;
}

/** After a call to a person: count the touch on their open lead and move it forward, or open one after a good conversation. */
export async function trackLeadCall(call: { contactId: string; result: string | null | undefined; rating?: string | null; at: Date; happened: boolean; campaignId?: string | null }, userId: string) {
  let leads = await db.lead.findMany({ where: { contactId: call.contactId, deletedAt: null, stage: { in: OPEN_LEAD_STAGES } } });
  if (!leads.length) {
    if (!LEAD_WORTHY_OUTCOMES.includes(call.result ?? "")) return;
    await openLeads([call.contactId], { source: call.campaignId ? "Campaign" : "Cold call", campaignId: call.campaignId ?? null, ownerId: userId }, userId);
    leads = await db.lead.findMany({ where: { contactId: call.contactId, deletedAt: null, stage: { in: OPEN_LEAD_STAGES } } });
  }
  for (const lead of leads) {
    const stage = leadStageForCall(lead.stage, call.result);
    const moved = stage !== lead.stage;
    await db.lead.update({
      where: { id: lead.id },
      data: {
        touches: { increment: 1 },
        lastResult: call.result ?? null,
        ...(call.happened && (!lead.lastTouchAt || lead.lastTouchAt < call.at) ? { lastTouchAt: call.at } : {}),
        ...(call.rating ? { label: call.rating } : {}),
        ...(moved ? { stage, stageEnteredAt: new Date() } : {}),
        // Whoever works an unowned lead takes it
        ...(lead.ownerId ? {} : { ownerId: userId }),
      },
    });
    if (moved) {
      await leadAudit(lead.id, { stage: { from: lead.stage, to: stage }, rule: { from: null, to: RULE } }, userId);
      await syncLifecycle([lead.contactId], { leadStatus: LEAD_STATUS_FOR_STAGE[stage] }, userId);
    }
  }
}
