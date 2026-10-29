import { db } from "@/lib/db";
import { fromBase64Url } from "@/lib/utils";
import { loadQueryContext, parseExclusions, parseSegmentGroups } from "./context";
import { DEFAULT_COLUMNS } from "./defaults";
import { PAGE_SIZES } from "./index-loader";
import { getPropertyGroups } from "./properties";
import { searchRecords } from "./insight-actions";
import { recordSegmentSize } from "./insights";
import { fetchRows, groupsWhere, searchWhere, withExclusions, type Where } from "./query";
import { canEditSegment, countRecords, segmentRecordsWhere, segmentSummaries, segmentVisibilityWhere } from "./segments";
import type { ColumnSpec, CrmObject, FilterGroup, SortSpec, UserLite } from "./types";

export interface SegmentSearchParams {
  page?: string;
  size?: string;
  q?: string;
  /** Unsaved filter draft (base64url FilterGroup[]) for active segments */
  f?: string;
  /** "property:asc|desc" */
  sort?: string;
}

export async function loadSegment(id: string, sp: SegmentSearchParams, userId: string) {
  const segment = await db.segment.findFirst({
    where: { AND: [{ id }, await segmentVisibilityWhere(userId)] },
    include: { owner: { select: { name: true, email: true } } },
  });
  if (!segment) return null;
  const object = segment.objectType as CrmObject;

  const [ctx, groups, users, settings, allSegments, canEdit] = await Promise.all([
    loadQueryContext(userId),
    getPropertyGroups(object),
    db.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true }, orderBy: { name: "asc" } }),
    db.objectSettings.findUnique({ where: { objectType: object } }),
    segmentSummaries(userId, object),
    canEditSegment(segment, userId),
  ]);
  const defs = ctx.defs[object];

  const saved = parseSegmentGroups(segment.filters);
  const draft = segment.type === "ACTIVE" ? fromBase64Url<FilterGroup[]>(sp.f) : null;
  const filters = draft ?? saved;

  const exclusions = parseExclusions(segment.exclusions);
  const base: Where = draft
    ? { AND: [{ deletedAt: null }, withExclusions(object, groupsWhere(object, draft, ctx) ?? { id: { in: [] } }, exclusions, ctx)] }
    : segmentRecordsWhere(object, segment.id, ctx);
  const search = searchWhere(object, sp.q ?? "");
  const where = search ? { AND: [base, search] } : base;
  const [size, database, excludedRecords] = await Promise.all([
    countRecords(object, base),
    countRecords(object, { deletedAt: null }),
    exclusions.records.length ? searchRecords(object, "", exclusions.records) : Promise.resolve([]),
  ]);
  // The size history only follows the saved definition
  const change7d = draft ? null : await recordSegmentSize(segment.id, size);

  const [sortProp, sortDir] = (sp.sort ?? "").split(":");
  const sort: SortSpec | null = sortProp ? { property: sortProp, direction: sortDir === "desc" ? "desc" : "asc" } : null;
  const pageSize = PAGE_SIZES.includes(Number(sp.size)) ? Number(sp.size) : 25;
  const page = Math.max(1, Number(sp.page) || 1);
  const { rows, total } = await fetchRows(object, where, sort, (page - 1) * pageSize, pageSize, defs);

  return {
    segment: {
      id: segment.id,
      name: segment.name,
      objectType: object,
      type: segment.type,
      visibility: segment.visibility,
      ownerName: segment.owner?.name ?? segment.owner?.email ?? null,
      createdAt: segment.createdAt.toISOString(),
      updatedAt: segment.updatedAt.toISOString(),
      description: segment.description,
    },
    size,
    database,
    change7d,
    exclusions,
    excludedRecords,
    filters,
    savedFilters: saved,
    dirty: !!draft,
    canEdit,
    rows,
    total,
    page,
    pageSize,
    q: sp.q ?? "",
    sort,
    // Object default columns (Settings), falling back to the built-in defaults
    columns: (settings?.defaultColumns as unknown as ColumnSpec[] | null)?.length
      ? (settings!.defaultColumns as unknown as ColumnSpec[])
      : DEFAULT_COLUMNS[object].map((property): ColumnSpec => ({ property })),
    defs,
    associatedDefs: object === "CONTACT" ? ctx.defs.COMPANY : ctx.defs.CONTACT,
    relatedDefs: ctx.relatedDefs,
    // A segment can't reference itself
    segments: allSegments.filter((s) => s.id !== segment.id),
    groups,
    users: users as UserLite[],
    previewProperties: (settings?.previewProperties as string[] | null) ?? [],
  };
}

export type SegmentData = NonNullable<Awaited<ReturnType<typeof loadSegment>>>;
