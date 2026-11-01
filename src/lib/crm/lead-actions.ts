"use server";

// Leads: open them for people, move them through New → Attempting → Connected → Qualified / Disqualified,
// assign, label and delete. Qualifying happens by creating a deal (deal-actions.createDeal with leadId).
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { FEEDBACK_RATINGS } from "./follow-up";
import { leadAudit, openLeads, syncLifecycle, type NewLead } from "./lead-sync";
import { DISQUALIFY_REASONS, LEAD_SOURCES, LEAD_STAGE_NAMES, LEAD_STATUS_FOR_STAGE, LEAD_TYPES, OPEN_LEAD_STAGES, isConversation, type LeadStage } from "./leads";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

function revalidateLeads(contactIds: string[] = []) {
  revalidatePath("/leads");
  for (const c of contactIds) revalidatePath(`/contacts/${c}`);
}

function checkLeadFields(input: { label?: string | null; leadType?: string | null; source?: string | null }) {
  if (input.label && !FEEDBACK_RATINGS.some((r) => r.value === input.label)) throw new Error("Unknown label");
  if (input.leadType && !(LEAD_TYPES as readonly string[]).includes(input.leadType)) throw new Error("Unknown lead type");
  if (input.source && !(LEAD_SOURCES as readonly string[]).includes(input.source)) throw new Error("Unknown source");
}

/** Open a lead for each of these people (skipping anyone who already has an open lead). */
export async function createLeads(contactIds: string[], input: NewLead = {}): Promise<Result<{ created: number; skipped: number }>> {
  try {
    const user = await requireUser();
    if (!contactIds.length) throw new Error("Pick people first");
    if (contactIds.length > 2000) throw new Error("Create at most 2,000 leads at a time");
    checkLeadFields(input);
    if (input.stage && !OPEN_LEAD_STAGES.includes(input.stage)) throw new Error("New leads start as New, Attempting or Connected");
    const ids = await openLeads(contactIds, input, user.id);
    revalidateLeads(contactIds);
    return { ok: true, data: { created: ids.length, skipped: contactIds.length - ids.length } };
  } catch (e) {
    return fail(e);
  }
}

/** One-off start: a lead for every person who has been called and never had one, staged from their call history. */
export async function createLeadsFromCalls(): Promise<Result<{ created: number }>> {
  try {
    const user = await requireUser();
    const contacts = await db.contact.findMany({
      where: { deletedAt: null, doNotCall: false, leads: { none: {} }, activities: { some: { activity: { type: "CALL", deletedAt: null } } } },
      select: {
        id: true,
        firstName: true,
        lastName: true,
        email: true,
        ownerId: true,
        companies: { where: { company: { deletedAt: null } }, orderBy: [{ isPrimary: "desc" }, { createdAt: "asc" }], take: 1, select: { company: { select: { id: true, name: true } } } },
        activities: {
          where: { activity: { type: "CALL", deletedAt: null } },
          select: { activity: { select: { occurredAt: true, callResult: true, feedbackRating: true, ownerId: true, campaignId: true } } },
        },
      },
    });
    const rows: Prisma.LeadCreateManyInput[] = [];
    for (const c of contacts) {
      const calls = c.activities.map((a) => a.activity).sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
      const latest = calls[0];
      const talks = calls.filter((a) => isConversation(a.callResult));
      const lastTalk = talks[0];
      const saidNo = lastTalk?.callResult === "Connected – Not Interested";
      const stage: LeadStage = !talks.length ? "Attempting" : saidNo ? "Disqualified" : "Connected";
      const company = c.companies[0]?.company ?? null;
      const name = [[c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "Unnamed", company?.name].filter(Boolean).join(" – ");
      rows.push({
        name,
        contactId: c.id,
        companyId: company?.id ?? null,
        ownerId: (lastTalk ?? latest).ownerId ?? c.ownerId ?? null,
        stage,
        stageEnteredAt: (lastTalk ?? latest).occurredAt,
        leadType: "New business",
        label: calls.find((a) => a.feedbackRating)?.feedbackRating ?? null,
        source: calls.some((a) => a.campaignId) ? "Campaign" : "Cold call",
        campaignId: calls.find((a) => a.campaignId)?.campaignId ?? null,
        disqualifyReason: saidNo ? "Not interested" : null,
        touches: calls.length,
        lastTouchAt: latest.occurredAt,
        lastResult: latest.callResult,
        closedAt: stage === "Disqualified" ? lastTalk.occurredAt : null,
        createdById: user.id,
        createdAt: calls[calls.length - 1].occurredAt,
      });
    }
    // In batches: thousands of people can have call history
    let created = 0;
    for (let i = 0; i < rows.length; i += 500) {
      const leads = await db.lead.createManyAndReturn({ data: rows.slice(i, i + 500), select: { id: true, stage: true } });
      await db.auditLog.createMany({
        data: leads.map((l) => ({ objectType: "LEAD" as const, recordId: l.id, action: "create", changes: { stage: { from: null, to: l.stage }, source: { from: null, to: "Call history" } }, userId: user.id })),
      });
      created += leads.length;
    }
    revalidateLeads();
    return { ok: true, data: { created } };
  } catch (e) {
    return fail(e);
  }
}

/** Move leads to a stage. Disqualifying needs a reason; qualifying is done by creating a deal. */
export async function moveLeads(ids: string[], stage: string, reason?: string): Promise<Result<{ moved: number }>> {
  try {
    const user = await requireUser();
    if (!LEAD_STAGE_NAMES.includes(stage as LeadStage)) throw new Error("Unknown lead stage");
    if (stage === "Qualified") throw new Error("Create a deal to qualify a lead");
    const why = reason?.trim() || null;
    if (stage === "Disqualified" && !why) throw new Error("Say why the lead is disqualified");
    if (why && stage === "Disqualified" && !(DISQUALIFY_REASONS as readonly string[]).includes(why)) throw new Error("Unknown reason");
    const leads = await db.lead.findMany({ where: { id: { in: ids }, deletedAt: null } });
    let moved = 0;
    for (const l of leads) {
      if (l.stage === stage) continue;
      const closing = stage === "Disqualified";
      await db.lead.update({
        where: { id: l.id },
        data: { stage, stageEnteredAt: new Date(), closedAt: closing ? new Date() : null, disqualifyReason: closing ? why : null, ...(closing ? {} : { dealId: null }) },
      });
      await leadAudit(l.id, { stage: { from: l.stage, to: stage }, ...(why ? { disqualifyReason: { from: l.disqualifyReason, to: why } } : {}) }, user.id);
      moved++;
    }
    await syncLifecycle(
      leads.filter((l) => l.stage !== stage).map((l) => l.contactId),
      { leadStatus: LEAD_STATUS_FOR_STAGE[stage as LeadStage] },
      user.id,
    );
    revalidateLeads(leads.map((l) => l.contactId));
    return { ok: true, data: { moved } };
  } catch (e) {
    return fail(e);
  }
}

export async function updateLeads(ids: string[], patch: { ownerId?: string | null; label?: string | null; leadType?: string | null; source?: string | null }): Promise<Result> {
  try {
    const user = await requireUser();
    checkLeadFields(patch);
    if (patch.ownerId && !(await db.user.count({ where: { id: patch.ownerId } }))) throw new Error("Unknown user");
    const leads = await db.lead.findMany({ where: { id: { in: ids }, deletedAt: null } });
    const keys = (["ownerId", "label", "leadType", "source"] as const).filter((k) => k in patch);
    for (const l of leads) {
      const changes = Object.fromEntries(keys.filter((k) => (l[k] ?? null) !== (patch[k] || null)).map((k) => [k, { from: l[k], to: patch[k] || null }]));
      if (!Object.keys(changes).length) continue;
      await db.lead.update({ where: { id: l.id }, data: Object.fromEntries(Object.entries(changes).map(([k, v]) => [k, v.to])) });
      await leadAudit(l.id, changes, user.id);
    }
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function deleteLeads(ids: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    await db.lead.updateMany({ where: { id: { in: ids } }, data: { deletedAt: new Date() } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: "LEAD" as const, recordId, action: "delete", changes: {}, userId: user.id })) });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function restoreLeads(ids: string[]): Promise<Result> {
  try {
    const user = await requireUser();
    await db.lead.updateMany({ where: { id: { in: ids } }, data: { deletedAt: null } });
    await db.auditLog.createMany({ data: ids.map((recordId) => ({ objectType: "LEAD" as const, recordId, action: "restore", changes: {}, userId: user.id })) });
    revalidateLeads();
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}
