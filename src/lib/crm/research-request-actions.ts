"use server";

// Research requests: a caller asks the research team about a company during calling; the researcher sends it back.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { OPEN_STATUSES } from "./calling-queue";
import { RECHECK_KIND } from "./recheck";
import { RESEARCH_REQUEST_KINDS } from "./research";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

/** How long a held company stays out of the caller's queue if research never answers. */
const HOLD_DAYS = 14;

function revalidate(companyId: string, campaignId: string | null) {
  revalidatePath("/research");
  revalidatePath(`/companies/${companyId}`);
  if (campaignId) revalidatePath(`/prospecting/${campaignId}`);
  revalidatePath("/prospecting");
}

async function timeline(companyId: string, userId: string, to: string) {
  await db.activity.create({
    data: { type: "SYSTEM", ownerId: userId, systemData: { kind: "property_change", label: "Research request", to }, companies: { create: { companyId } } },
  });
}

/** Put a held company back at the top of its campaign queue. */
async function release(campaignId: string | null, companyId: string) {
  if (!campaignId) return;
  await db.campaignCompany.updateMany({ where: { campaignId, companyId, removedAt: null, status: { in: OPEN_STATUSES } }, data: { nextActionAt: new Date() } });
}

export async function createResearchRequest(input: {
  companyId: string;
  contactId?: string | null;
  campaignId?: string | null;
  kind: string;
  note?: string | null;
  /** Take the company out of the queue until the research comes back */
  hold?: boolean;
}): Promise<Result<{ id: string }>> {
  try {
    const user = await requireUser();
    if (!(RESEARCH_REQUEST_KINDS as readonly string[]).includes(input.kind)) throw new Error("Choose what you need");
    if (input.kind === "Other" && !input.note?.trim()) throw new Error("Say what you need researched");
    const open = await db.researchRequest.findFirst({ where: { companyId: input.companyId, kind: input.kind, contactId: input.contactId || null, status: { in: ["Open", "In progress"] } } });
    if (open) throw new Error("There's already an open request like this for this company");
    const company = await db.company.findUniqueOrThrow({ where: { id: input.companyId }, select: { researcherId: true, name: true } });
    const contact = input.contactId ? await db.contact.findUnique({ where: { id: input.contactId }, select: { firstName: true, lastName: true } }) : null;

    const r = await db.researchRequest.create({
      data: {
        companyId: input.companyId,
        contactId: input.contactId || null,
        campaignId: input.campaignId || null,
        kind: input.kind,
        note: input.note?.trim() || null,
        requestedById: user.id,
      },
    });
    if (input.hold && input.campaignId) {
      await db.campaignCompany.updateMany({
        where: { campaignId: input.campaignId, companyId: input.companyId, removedAt: null },
        data: { nextActionAt: new Date(Date.now() + HOLD_DAYS * 864e5) },
      });
    }
    const who = contact ? ` (${[contact.firstName, contact.lastName].filter(Boolean).join(" ")})` : "";
    await timeline(input.companyId, user.id, `${input.kind}${who} requested${input.note?.trim() ? `: ${input.note.trim()}` : ""}`);
    // The company's researcher hears about it first
    if (company.researcherId && company.researcherId !== user.id) {
      await db.notification.create({ data: { userId: company.researcherId, kind: "research_request", title: `Research request: ${company.name} – ${input.kind}`, link: "/research" } });
    }
    revalidate(input.companyId, input.campaignId ?? null);
    return { ok: true, data: { id: r.id } };
  } catch (e) {
    return fail(e);
  }
}

export async function startResearchRequest(id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const r = await db.researchRequest.findUniqueOrThrow({ where: { id } });
    if (r.status !== "Open") throw new Error(`This request is already ${r.status.toLowerCase()}`);
    await db.researchRequest.update({ where: { id }, data: { status: "In progress", researcherId: user.id } });
    revalidate(r.companyId, r.campaignId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** Send the result back: the company returns to the top of the caller's queue. */
export async function sendBackResearchRequest(id: string, result: string): Promise<Result> {
  try {
    const user = await requireUser();
    if (!result.trim()) throw new Error("Write what you found, so the caller knows");
    const r = await db.researchRequest.findUniqueOrThrow({ where: { id }, include: { company: { select: { name: true } } } });
    if (r.status === "Sent back" || r.status === "Cancelled") throw new Error(`This request is already ${r.status.toLowerCase()}`);
    await db.researchRequest.update({ where: { id }, data: { status: "Sent back", result: result.trim(), researcherId: r.researcherId ?? user.id, resolvedAt: new Date(), seenAt: null } });
    await release(r.campaignId, r.companyId);
    // A re-check refreshes the research date, so the company isn't sent for another one on its next return
    if (r.kind === RECHECK_KIND) await db.company.update({ where: { id: r.companyId }, data: { researchedAt: new Date() } });
    await timeline(r.companyId, user.id, `${r.kind} sent back: ${result.trim()}`);
    if (r.requestedById && r.requestedById !== user.id) {
      await db.notification.create({
        data: {
          userId: r.requestedById,
          kind: "research_back",
          title: `Research back: ${r.company.name} – ${r.kind}`,
          link: r.campaignId ? `/prospecting/${r.campaignId}?caller=all&id=${r.companyId}` : `/companies/${r.companyId}`,
        },
      });
    }
    revalidate(r.companyId, r.campaignId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

export async function cancelResearchRequest(id: string): Promise<Result> {
  try {
    const user = await requireUser();
    const r = await db.researchRequest.findUniqueOrThrow({ where: { id } });
    if (r.status === "Sent back" || r.status === "Cancelled") throw new Error(`This request is already ${r.status.toLowerCase()}`);
    await db.researchRequest.update({ where: { id }, data: { status: "Cancelled", resolvedAt: new Date() } });
    await release(r.campaignId, r.companyId);
    await timeline(r.companyId, user.id, `${r.kind} cancelled`);
    revalidate(r.companyId, r.campaignId);
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

/** The caller has read the result. */
export async function markResearchSeen(ids: string[]): Promise<Result> {
  try {
    await requireUser();
    await db.researchRequest.updateMany({ where: { id: { in: ids }, seenAt: null }, data: { seenAt: new Date() } });
    return { ok: true };
  } catch (e) {
    return fail(e);
  }
}

// ── Bulk (the Research Queue's request list sends large selections in chunks) ──

/** Take open requests yourself, or give them to another researcher. */
export async function assignResearchRequests(ids: string[], researcherId: string | null): Promise<Result<{ updated: number }>> {
  try {
    const user = await requireUser();
    const who = researcherId ?? user.id;
    const res = await db.researchRequest.updateMany({ where: { id: { in: ids }, status: { in: ["Open", "In progress"] } }, data: { status: "In progress", researcherId: who } });
    revalidatePath("/research");
    return { ok: true, data: { updated: res.count } };
  } catch (e) {
    return fail(e);
  }
}

/** Send many requests back with the same answer, or cancel them. At most 100 per call. */
export async function finishResearchRequests(ids: string[], action: "send_back" | "cancel", result?: string): Promise<Result<{ done: number; failed: number }>> {
  try {
    await requireUser();
    if (ids.length > 100) throw new Error("Send at most 100 requests per call");
    let done = 0;
    let failed = 0;
    for (const id of ids) {
      const res = action === "send_back" ? await sendBackResearchRequest(id, result ?? "") : await cancelResearchRequest(id);
      if (res.ok) done++;
      else failed++;
    }
    return { ok: true, data: { done, failed } };
  } catch (e) {
    return fail(e);
  }
}
