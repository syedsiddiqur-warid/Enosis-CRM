"use server";

// Leads: open them for people, move them through New → Attempting → Connected → Qualified / Disqualified,
// assign, label and delete.
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { FEEDBACK_RATINGS } from "./follow-up";
import { STAGE } from "./journey";
import { leadAudit, openLeads, syncLifecycle, type NewLead } from "./lead-sync";
import { advanceJourney } from "./record-writes";
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

/** Move leads to a stage. Disqualifying needs a reason; qualifying moves the person to SQL and the company's journey to Opportunity. */
export async function moveLeads(ids: string[], stage: string, reason?: string): Promise<Result<{ moved: number }>> {
  try {
    const user = await requireUser();
    if (!LEAD_STAGE_NAMES.includes(stage as LeadStage)) throw new Error("Unknown lead stage");
    const why = reason?.trim() || null;
    if (stage === "Disqualified" && !why) throw new Error("Say why the lead is disqualified");
    if (why && stage === "Disqualified" && !(DISQUALIFY_REASONS as readonly string[]).includes(why)) throw new Error("Unknown reason");
    const qualifying = stage === "Qualified";
    const now = new Date();
    const data = { stage, stageEnteredAt: now, closedAt: stage === "Disqualified" || qualifying ? now : null, disqualifyReason: stage === "Disqualified" ? why : null };
    // Bulk moves can cover thousands of leads, so write in batches rather than one lead at a time
    const toMove = await db.lead.findMany({
      where: { id: { in: ids }, deletedAt: null, stage: { not: stage } },
      select: { id: true, stage: true, contactId: true, companyId: true, disqualifyReason: true },
    });
    for (let i = 0; i < toMove.length; i += 1000) {
      const chunk = toMove.slice(i, i + 1000);
      await db.lead.updateMany({ where: { id: { in: chunk.map((l) => l.id) } }, data });
      await db.auditLog.createMany({
        data: chunk.map((l) => ({
          objectType: "LEAD" as const,
          recordId: l.id,
          action: "update",
          changes: { stage: { from: l.stage, to: stage }, ...(why ? { disqualifyReason: { from: l.disqualifyReason, to: why } } : {}) },
          userId: user.id,
        })),
      });
    }
    // A qualified lead is a real opportunity for its company (once per company, however many of its people qualify)
    if (qualifying) {
      for (const companyId of new Set(toMove.map((l) => l.companyId).filter((c): c is string => !!c))) {
        await advanceJourney(companyId, STAGE.opportunity, user.id, { source: "manual", reason: "Lead qualified" });
      }
    }
    const contactIds = [...new Set(toMove.map((l) => l.contactId))];
    await syncLifecycle(contactIds, { leadStatus: LEAD_STATUS_FOR_STAGE[stage as LeadStage], ...(qualifying ? { lifecycle: "SQL" } : {}) }, user.id);
    revalidateLeads(contactIds.length > 50 ? [] : contactIds);
    return { ok: true, data: { moved: toMove.length } };
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
