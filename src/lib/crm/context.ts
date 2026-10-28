import { db } from "@/lib/db";
import { getPropDefs, getRelatedFilterDefs } from "./properties";
import type { QueryContext, SegmentDefinition } from "./query";
import type { CrmObject, FilterGroup, PropDef, RelatedDefs } from "./types";

/** Segment filters are stored as FilterGroup[]; tolerate a bare group or a view-style { advanced }. */
export function parseSegmentGroups(filters: unknown): FilterGroup[] {
  if (Array.isArray(filters)) return filters as FilterGroup[];
  if (filters && typeof filters === "object") {
    const f = filters as { advanced?: FilterGroup[]; conditions?: FilterGroup["conditions"]; op?: FilterGroup["op"] };
    if (f.advanced) return f.advanced;
    if (f.conditions) return [{ op: f.op ?? "AND", conditions: f.conditions }];
  }
  return [];
}

/** Everything the filter engine needs: property definitions, related-row fields and segment definitions. */
export async function loadQueryContext(userId: string): Promise<QueryContext & { defs: Record<CrmObject, PropDef[]>; relatedDefs: RelatedDefs }> {
  const [contactDefs, companyDefs, relatedDefs, segments] = await Promise.all([
    getPropDefs("CONTACT"),
    getPropDefs("COMPANY"),
    getRelatedFilterDefs(),
    db.segment.findMany({ select: { id: true, objectType: true, type: true, filters: true } }),
  ]);
  return {
    userId,
    defs: { CONTACT: contactDefs, COMPANY: companyDefs, DEAL: [] },
    relatedDefs,
    segments: new Map(
      segments.map((s): [string, SegmentDefinition] => [s.id, { objectType: s.objectType as CrmObject, type: s.type, groups: parseSegmentGroups(s.filters) }]),
    ),
  };
}
