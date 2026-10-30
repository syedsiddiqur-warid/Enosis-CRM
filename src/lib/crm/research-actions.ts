"use server";

// Research Queue at scale: paging the board, selecting every matching company, bulk researcher assignment.
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import type { ResearchColumn } from "./research";
import { BOARD_PAGE, researchCards, researchIndex, requestWhere, type ResearchCard, type ResearchFilters, type ResearchSearchParams } from "./research-loader";

type Result<T = undefined> = { ok: true; data?: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

/** The next cards of one board column. */
export async function loadMoreResearchCards(filters: ResearchFilters, column: ResearchColumn, offset: number): Promise<Result<ResearchCard[]>> {
  try {
    const user = await requireUser();
    const ids = (await researchIndex(filters, user.id))
      .filter((r) => r.column === column)
      .slice(offset, offset + BOARD_PAGE)
      .map((r) => r.id);
    return { ok: true, data: await researchCards(ids) };
  } catch (e) {
    return fail(e);
  }
}

/** Ids of every company matching the filters (optionally one column), for "select all". */
export async function researchIdsMatching(filters: ResearchFilters, column: ResearchColumn | null): Promise<Result<string[]>> {
  try {
    const user = await requireUser();
    return { ok: true, data: (await researchIndex(filters, user.id)).filter((r) => !column || r.column === column).map((r) => r.id) };
  } catch (e) {
    return fail(e);
  }
}

/** Assign companies to one researcher, spread them evenly across several, or unassign (empty list). */
export async function assignResearchers(ids: string[], researcherIds: string[]): Promise<Result<{ assigned: number }>> {
  try {
    const user = await requireUser();
    if (!ids.length) throw new Error("Select companies first");
    if (ids.length > 20000) throw new Error("Assign at most 20,000 companies at a time");
    const valid = researcherIds.length ? await db.user.count({ where: { id: { in: researcherIds }, isActive: true } }) : 0;
    if (valid !== researcherIds.length) throw new Error("Unknown researcher");
    // Round robin keeps the split even: with 3 researchers each gets every third company
    const groups = new Map<string | null, string[]>();
    ids.forEach((id, i) => {
      const who = researcherIds.length ? researcherIds[i % researcherIds.length] : null;
      groups.set(who, [...(groups.get(who) ?? []), id]);
    });
    for (const [researcherId, group] of groups) {
      for (let i = 0; i < group.length; i += 5000) {
        const chunk = group.slice(i, i + 5000);
        await db.company.updateMany({ where: { id: { in: chunk } }, data: { researcherId } });
        await db.auditLog.createMany({
          data: chunk.map((recordId) => ({ objectType: "COMPANY" as const, recordId, action: "update", changes: { researcherId: { to: researcherId } }, userId: user.id })),
        });
      }
    }
    revalidatePath("/research");
    revalidatePath("/companies", "layout");
    return { ok: true, data: { assigned: ids.length } };
  } catch (e) {
    return fail(e);
  }
}

/** Ids of every caller request matching the request filters, for "select all". */
export async function requestIdsMatching(sp: ResearchSearchParams): Promise<Result<string[]>> {
  try {
    const user = await requireUser();
    const rows = await db.researchRequest.findMany({ where: requestWhere(sp, user.id), select: { id: true }, orderBy: { createdAt: "asc" }, take: 20000 });
    return { ok: true, data: rows.map((r) => r.id) };
  } catch (e) {
    return fail(e);
  }
}
