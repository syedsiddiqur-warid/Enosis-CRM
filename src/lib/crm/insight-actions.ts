"use server";

// Statistics for segments and list views, segment comparison and "test a record".
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/auth";
import { db } from "@/lib/db";
import { loadQueryContext, parseExclusions, parseSegmentGroups } from "./context";
import { computeInsights, explainMatch, recordSegmentSize, segmentWhere, type Insights, type MatchReport } from "./insights";
import { buildWhere } from "./query";
import { segmentVisibilityWhere } from "./segments";
import type { CrmObject, FilterGroup, SegmentExclusions, UserLite, ViewState } from "./types";

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: e instanceof Error ? e.message : "Something went wrong" });

async function users(): Promise<UserLite[]> {
  return db.user.findMany({ select: { id: true, name: true, email: true } });
}

async function visibleSegment(id: string, userId: string) {
  const s = await db.segment.findFirst({ where: { AND: [{ id }, await segmentVisibilityWhere(userId)] } });
  if (!s) throw new Error("Segment not found");
  return s;
}

/** Insights for a segment, or for unsaved changes to its filters / exclusions. */
export async function segmentInsights(segmentId: string, draft?: { groups?: FilterGroup[] | null; exclusions?: SegmentExclusions | null }): Promise<Result<Insights>> {
  try {
    const user = await requireUser();
    const s = await visibleSegment(segmentId, user.id);
    const object = s.objectType as CrmObject;
    const ctx = await loadQueryContext(user.id);
    const where = draft
      ? segmentWhere(object, s.id, ctx, {
          type: s.type,
          groups: draft.groups ?? parseSegmentGroups(s.filters),
          exclusions: draft.exclusions ?? parseExclusions(s.exclusions),
        })
      : segmentWhere(object, s.id, ctx);
    return { ok: true, data: await computeInsights(object, where, ctx, await users()) };
  } catch (e) {
    return fail(e);
  }
}

/** Insights for what a contacts / companies list currently shows (view, filters, search). */
export async function viewInsights(object: CrmObject, systemKey: string | null, state: ViewState, q: string): Promise<Result<Insights>> {
  try {
    const user = await requireUser();
    const ctx = await loadQueryContext(user.id);
    return { ok: true, data: await computeInsights(object, buildWhere(object, systemKey, state, q, ctx), ctx, await users()) };
  } catch (e) {
    return fail(e);
  }
}

export interface SegmentComparison {
  object: CrmObject;
  segments: { id: string; name: string; type: "ACTIVE" | "STATIC"; createdAt: string; size: number; change7d: number | null; insights: Insights; only: number }[];
  /** overlap[i][j]: records in both segment i and segment j */
  overlap: number[][];
}

/** Side-by-side numbers and overlap for 2–4 segments of the same object. */
export async function compareSegments(ids: string[]): Promise<Result<SegmentComparison>> {
  try {
    const user = await requireUser();
    if (ids.length < 2 || ids.length > 4) throw new Error("Pick 2 to 4 segments");
    const segs = await Promise.all(ids.map((id) => visibleSegment(id, user.id)));
    const object = segs[0].objectType as CrmObject;
    if (segs.some((s) => s.objectType !== object)) throw new Error("Compare segments of the same object (all contacts or all companies)");
    const ctx = await loadQueryContext(user.id);
    const us = await users();
    const wheres = segs.map((s) => segmentWhere(object, s.id, ctx));
    const count = (w: unknown) => (object === "CONTACT" ? db.contact.count({ where: w as Prisma.ContactWhereInput }) : db.company.count({ where: w as Prisma.CompanyWhereInput }));
    const overlap = await Promise.all(wheres.map((a, i) => Promise.all(wheres.map((b, j) => (i === j ? Promise.resolve(-1) : count({ AND: [a, b] }))))));
    const rows = await Promise.all(
      segs.map(async (s, i) => {
        const insights = await computeInsights(object, wheres[i], ctx, us);
        const others = wheres.filter((_, j) => j !== i);
        return {
          id: s.id,
          name: s.name,
          type: s.type,
          createdAt: s.createdAt.toISOString(),
          size: insights.total,
          change7d: await recordSegmentSize(s.id, insights.total),
          insights,
          only: await count({ AND: [wheres[i], { NOT: { OR: others } }] }),
        };
      }),
    );
    for (let i = 0; i < rows.length; i++) overlap[i][i] = rows[i].size;
    return { ok: true, data: { object, segments: rows, overlap } };
  } catch (e) {
    return fail(e);
  }
}

/** Why one record is or isn't in a segment (with its saved or draft filters and exclusions). */
export async function testSegmentMatch(segmentId: string, recordId: string, draft?: { groups?: FilterGroup[] | null; exclusions?: SegmentExclusions | null }): Promise<Result<MatchReport>> {
  try {
    const user = await requireUser();
    const s = await visibleSegment(segmentId, user.id);
    const ctx = await loadQueryContext(user.id);
    const report = await explainMatch(
      s.objectType as CrmObject,
      recordId,
      { id: s.id, type: s.type, groups: draft?.groups ?? parseSegmentGroups(s.filters), exclusions: draft?.exclusions ?? parseExclusions(s.exclusions) },
      ctx,
    );
    return { ok: true, data: report };
  } catch (e) {
    return fail(e);
  }
}

/** Contacts or companies by name for pickers (exclusions, test a record). */
export async function searchRecords(object: CrmObject, q: string, ids?: string[]) {
  await requireUser();
  const s = q.trim();
  if (object === "CONTACT") {
    const rows = await db.contact.findMany({
      where: {
        deletedAt: null,
        ...(ids ? { id: { in: ids } } : s ? { OR: [{ firstName: { contains: s, mode: "insensitive" } }, { lastName: { contains: s, mode: "insensitive" } }, { email: { contains: s, mode: "insensitive" } }] } : {}),
      },
      select: { id: true, firstName: true, lastName: true, email: true, jobTitle: true },
      orderBy: [{ firstName: "asc" }],
      take: ids ? undefined : 12,
    });
    return rows.map((c) => ({ id: c.id, name: [c.firstName, c.lastName].filter(Boolean).join(" ") || c.email || "(No name)", subtitle: c.jobTitle ?? c.email }));
  }
  const rows = await db.company.findMany({
    where: { deletedAt: null, ...(ids ? { id: { in: ids } } : s ? { OR: [{ name: { contains: s, mode: "insensitive" } }, { domain: { contains: s, mode: "insensitive" } }] } : {}) },
    select: { id: true, name: true, domain: true },
    orderBy: { name: "asc" },
    take: ids ? undefined : 12,
  });
  return rows.map((c) => ({ id: c.id, name: c.name, subtitle: c.domain }));
}
