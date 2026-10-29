// Segments (HubSpot "lists"): active segments are filter-based and always current,
// static segments are hand-picked member rows.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { recordSegmentSize } from "./insights";
import { segmentMembershipWhere, type QueryContext, type Where } from "./query";
import type { CrmObject, SegmentSummary } from "./types";

export async function segmentVisibilityWhere(userId: string): Promise<Prisma.SegmentWhereInput> {
  const me = await db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } });
  if (me?.role?.name === "Admin") return {};
  // Segments have no team link yet, so TEAM-visible segments behave like EVERYONE
  return { OR: [{ ownerId: userId }, { visibility: { in: ["EVERYONE", "TEAM"] } }] };
}

export async function canEditSegment(segment: { ownerId: string | null }, userId: string) {
  if (segment.ownerId === userId) return true;
  const me = await db.user.findUnique({ where: { id: userId }, select: { role: { select: { name: true } } } });
  return me?.role?.name === "Admin" || me?.role?.name === "Manager";
}

export function countRecords(object: CrmObject, where: Where) {
  if (object === "CONTACT") return db.contact.count({ where: where as Prisma.ContactWhereInput });
  if (object === "COMPANY") return db.company.count({ where: where as Prisma.CompanyWhereInput });
  return Promise.resolve(0);
}

export function segmentRecordsWhere(object: CrmObject, segmentId: string, ctx: QueryContext): Where {
  return { AND: [{ deletedAt: null }, segmentMembershipWhere(object, segmentId, ctx)] };
}

export async function listSegments(userId: string, ctx: QueryContext) {
  const rows = await db.segment.findMany({
    where: await segmentVisibilityWhere(userId),
    include: { owner: { select: { name: true, email: true } } },
    orderBy: { updatedAt: "desc" },
  });
  const [contacts, companies] = await Promise.all([db.contact.count({ where: { deletedAt: null } }), db.company.count({ where: { deletedAt: null } })]);
  return Promise.all(
    rows.map(async (s) => {
      const object = s.objectType as CrmObject;
      const size = await countRecords(object, segmentRecordsWhere(object, s.id, ctx));
      return {
        id: s.id,
        name: s.name,
        description: s.description,
        objectType: object,
        type: s.type,
        visibility: s.visibility,
        ownerName: s.owner?.name ?? s.owner?.email ?? null,
        isOwn: s.ownerId === userId,
        createdAt: s.createdAt.toISOString(),
        updatedAt: s.updatedAt.toISOString(),
        size,
        database: object === "CONTACT" ? contacts : companies,
        change7d: await recordSegmentSize(s.id, size),
      };
    }),
  );
}

export type SegmentListRow = Awaited<ReturnType<typeof listSegments>>[number];

export async function segmentSummaries(userId: string, object?: CrmObject): Promise<SegmentSummary[]> {
  const rows = await db.segment.findMany({
    where: { AND: [await segmentVisibilityWhere(userId), object ? { objectType: object } : {}] },
    select: { id: true, name: true, objectType: true, type: true },
    orderBy: { name: "asc" },
  });
  return rows.map((r) => ({ ...r, objectType: r.objectType as CrmObject }));
}

/** Segments a record currently belongs to (static membership or matching an active segment's filters). */
export async function recordSegments(object: CrmObject, recordId: string, userId: string, ctx: QueryContext) {
  const segments = await segmentSummaries(userId, object);
  const matches = await Promise.all(
    segments.map(async (s) => ((await countRecords(object, { AND: [{ id: recordId }, segmentRecordsWhere(object, s.id, ctx)] })) > 0 ? s : null)),
  );
  return matches.filter((s): s is SegmentSummary => !!s);
}
