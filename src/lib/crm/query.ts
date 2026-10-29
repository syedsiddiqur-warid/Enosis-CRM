// Turns index-page state (quick filters, advanced groups, search, sort) into Prisma queries.
// Built-in properties map to columns; custom properties are read from the `properties` jsonb.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { dayRange, resolveRelative } from "./dates";
import { isSortable } from "./properties";
import {
  RELATED_KINDS,
  type SegmentExclusions,
  SEGMENT_PROPERTY,
  isRelated,
  type CrmObject,
  type FilterCondition,
  type FilterGroup,
  type PropDef,
  type RelatedDefs,
  type RelatedKind,
  type SortSpec,
  type ViewState,
} from "./types";

export type Where = Record<string, unknown>;

export interface SegmentDefinition {
  objectType: CrmObject;
  type: "ACTIVE" | "STATIC";
  groups: FilterGroup[];
  exclusions?: SegmentExclusions | null;
}

export interface QueryContext {
  userId: string;
  defs: Record<CrmObject, PropDef[]>;
  /** Filterable fields of related rows: logged calls, buying signals, campaign memberships */
  relatedDefs?: RelatedDefs;
  /** Segments that "segment membership" conditions may reference */
  segments?: Map<string, SegmentDefinition>;
  /** Nesting depth of active segments referencing other segments */
  depth?: number;
}

const MAX_SEGMENT_DEPTH = 3;
const MATCH_NOTHING: Where = { id: { in: [] } };

function arr(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(String);
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function dateBounds(cond: FilterCondition): { gte?: Date; lte?: Date; lt?: Date; gt?: Date } | null {
  const v = cond.value;
  switch (cond.operator) {
    case "on": {
      if (typeof v !== "string") return null;
      const [a, b] = dayRange(v);
      return { gte: a, lte: b };
    }
    case "before":
      return typeof v === "string" ? { lt: dayRange(v)[0] } : null;
    case "after":
      return typeof v === "string" ? { gt: dayRange(v)[1] } : null;
    case "date_between": {
      if (!Array.isArray(v) || !v[0] || !v[1]) return null;
      return { gte: dayRange(String(v[0]))[0], lte: dayRange(String(v[1]))[1] };
    }
    case "more_than_days_ago":
      return { lt: new Date(Date.now() - Number(v ?? 0) * 864e5) };
    case "less_than_days_ago":
      return { gte: new Date(Date.now() - Number(v ?? 0) * 864e5) };
    case "relative": {
      const r = (v ?? {}) as { preset?: string; days?: number };
      if (!r.preset) return null;
      const [a, b] = resolveRelative(r.preset, r.days);
      return { gte: a, lte: b };
    }
    default:
      return null;
  }
}

/** Non-nullable scalar columns per Prisma model: these can't take `null` comparisons. */
const REQUIRED_COLUMNS = new Map(
  Prisma.dmmf.datamodel.models.map((m) => [m.name, new Set(m.fields.filter((f) => f.kind === "scalar" && f.isRequired && !f.isList).map((f) => f.name))]),
);
const MODELS: Record<CrmObject | RelatedKind, string> = { CONTACT: "Contact", COMPANY: "Company", DEAL: "Deal", CALL: "Activity", SIGNAL: "BuyingSignal", CAMPAIGN: "CampaignCompany" };

/** Where clause for a typed column of `model` (a CrmObject or related-row kind). */
function columnWhere(field: string, def: PropDef, cond: FilterCondition, ctx: QueryContext, model: CrmObject | RelatedKind): Where | null {
  const { operator: op, value } = cond;
  const required = REQUIRED_COLUMNS.get(MODELS[model])?.has(field) ?? false;
  const isText = ["TEXT", "TEXTAREA", "EMAIL", "PHONE", "URL"].includes(def.type);
  if (op === "is_known") {
    if (def.type === "MULTI_ENUM") return { [field]: { isEmpty: false } };
    if (def.type === "BOOLEAN") return {};
    if (isText) return required ? { NOT: { [field]: "" } } : { AND: [{ [field]: { not: null } }, { NOT: { [field]: "" } }] };
    return required ? {} : { [field]: { not: null } };
  }
  if (op === "is_unknown") {
    if (def.type === "MULTI_ENUM") return { [field]: { isEmpty: true } };
    if (isText) return required ? { [field]: "" } : { OR: [{ [field]: null }, { [field]: "" }] };
    return required ? MATCH_NOTHING : { [field]: null };
  }
  // "Empty or different" comparisons only include the empty case when the column can be empty
  const orNull = (w: Where): Where => (required ? w : { OR: [{ [field]: null }, w] });

  switch (def.type) {
    case "TEXT":
    case "TEXTAREA":
    case "RICH_TEXT":
    case "EMAIL":
    case "PHONE":
    case "URL": {
      // A pasted list of exact values: names, domains, cities…
      if (op === "is_any_of" || op === "is_none_of") {
        const vals = arr(value).map((x) => x.trim()).filter(Boolean);
        if (!vals.length) return null;
        const any = { OR: vals.map((x) => ({ [field]: { equals: x, mode: "insensitive" } })) };
        return op === "is_any_of" ? any : orNull({ NOT: any });
      }
      const v = String(value ?? "");
      if (!v) return null;
      if (op === "contains") return { [field]: { contains: v, mode: "insensitive" } };
      if (op === "not_contains") return orNull({ NOT: { [field]: { contains: v, mode: "insensitive" } } });
      if (op === "is") return { [field]: { equals: v, mode: "insensitive" } };
      if (op === "starts_with") return { [field]: { startsWith: v, mode: "insensitive" } };
      if (op === "ends_with") return { [field]: { endsWith: v, mode: "insensitive" } };
      return null;
    }
    case "ENUM":
    case "RADIO":
    case "USER": {
      let vals = arr(value);
      if (!vals.length) return null;
      if (def.type === "USER") vals = vals.map((v) => (v === "__me__" ? ctx.userId : v));
      const wantsNull = vals.includes("__none__") && !required;
      vals = vals.filter((v) => v !== "__none__");
      if (op === "is_any_of") {
        const ors: Where[] = [];
        if (vals.length) ors.push({ [field]: { in: vals } });
        if (wantsNull) ors.push({ [field]: null });
        return ors.length === 1 ? ors[0] : ors.length ? { OR: ors } : MATCH_NOTHING;
      }
      if (op === "is_none_of") {
        const ands: Where[] = [];
        if (vals.length) ands.push(orNull({ [field]: { notIn: vals } }));
        if (wantsNull) ands.push({ [field]: { not: null } });
        return { AND: ands };
      }
      return null;
    }
    case "MULTI_ENUM": {
      const vals = arr(value);
      if (!vals.length) return null;
      if (op === "is_any_of") return { [field]: { hasSome: vals } };
      if (op === "is_all_of") return { [field]: { hasEvery: vals } };
      if (op === "is_none_of") return { NOT: { [field]: { hasSome: vals } } };
      return null;
    }
    case "NUMBER":
    case "AUTO_NUMBER": {
      if (op === "between") {
        const [a, b] = Array.isArray(value) ? value.map(Number) : [];
        if (a === undefined || b === undefined || Number.isNaN(a) || Number.isNaN(b)) return null;
        return { [field]: { gte: a, lte: b } };
      }
      const n = Number(value);
      if (value === "" || value === undefined || Number.isNaN(n)) return null;
      if (op === "eq") return { [field]: n };
      if (op === "neq") return orNull({ [field]: { not: n } });
      if (op === "gt") return { [field]: { gt: n } };
      if (op === "lt") return { [field]: { lt: n } };
      if (op === "gte") return { [field]: { gte: n } };
      if (op === "lte") return { [field]: { lte: n } };
      return null;
    }
    case "BOOLEAN":
      if (op === "is") return { [field]: value === true || value === "true" };
      return null;
    case "DATE":
    case "DATETIME": {
      const b = dateBounds(cond);
      return b ? { [field]: b } : null;
    }
    default:
      return null;
  }
}

/** Where clause for a custom property stored in the `properties` jsonb column. */
function jsonWhere(name: string, def: PropDef, cond: FilterCondition): Where | null {
  const path = [name];
  const { operator: op, value } = cond;
  const p = (filter: Where) => ({ properties: { path, ...filter } });
  if (op === "is_known") return { NOT: [p({ equals: Prisma.AnyNull }), p({ equals: "" })] };
  if (op === "is_unknown") return { OR: [p({ equals: Prisma.AnyNull }), p({ equals: "" })] };

  switch (def.type) {
    case "ENUM":
    case "RADIO":
    case "USER": {
      const vals = arr(value);
      if (!vals.length) return null;
      const any = { OR: vals.map((v) => p({ equals: v })) };
      return op === "is_none_of" ? { NOT: any } : any;
    }
    case "MULTI_ENUM": {
      const vals = arr(value);
      if (!vals.length) return null;
      if (op === "is_all_of") return { AND: vals.map((v) => p({ array_contains: [v] })) };
      const any = { OR: vals.map((v) => p({ array_contains: [v] })) };
      return op === "is_none_of" ? { NOT: any } : any;
    }
    case "NUMBER": {
      if (op === "between" && Array.isArray(value)) return { AND: [p({ gte: Number(value[0]) }), p({ lte: Number(value[1]) })] };
      const n = Number(value);
      if (Number.isNaN(n)) return null;
      if (op === "eq") return p({ equals: n });
      if (op === "neq") return { NOT: p({ equals: n }) };
      if (op === "gt") return p({ gt: n });
      if (op === "lt") return p({ lt: n });
      if (op === "gte") return p({ gte: n });
      if (op === "lte") return p({ lte: n });
      return null;
    }
    case "BOOLEAN":
      return op === "is" ? p({ equals: value === true || value === "true" }) : null;
    case "DATE":
    case "DATETIME": {
      // ISO strings compare correctly as text
      const b = dateBounds(cond);
      if (!b) return null;
      const parts = Object.entries(b).map(([k, d]) => p({ [k]: (d as Date).toISOString().slice(0, def.type === "DATE" ? 10 : 24) }));
      return { AND: parts };
    }
    default: {
      if (op === "is_any_of" || op === "is_none_of") {
        const vals = arr(value).map((x) => x.trim()).filter(Boolean);
        if (!vals.length) return null;
        const any = { OR: vals.map((x) => p({ equals: x })) };
        return op === "is_any_of" ? any : { NOT: any };
      }
      const v = String(value ?? "");
      if (!v) return null;
      if (op === "contains") return p({ string_contains: v });
      if (op === "not_contains") return { NOT: p({ string_contains: v }) };
      if (op === "is") return p({ equals: v });
      if (op === "starts_with") return p({ string_starts_with: v });
      if (op === "ends_with") return p({ string_ends_with: v });
      return null;
    }
  }
}

/** Records with at least one related row (call, buying signal, campaign membership) matching every
 *  condition, all on the same row. Contacts reach signals and campaigns through their companies. */
function relatedWhere(object: CrmObject, kind: RelatedKind, conds: FilterCondition[], ctx: QueryContext): Where | null {
  const parts = conds
    .map((c) => {
      const def = ctx.relatedDefs?.[kind]?.find((d) => d.name === c.property);
      return def ? columnWhere(def.name, def, c, ctx, kind) : null;
    })
    .filter((w): w is Where => !!w);
  if (!parts.length) return null;
  if (kind === "CALL") return { activities: { some: { activity: { type: "CALL", deletedAt: null, AND: parts } } } };
  const onCompany = kind === "SIGNAL" ? { signals: { some: { AND: parts } } } : { campaigns: { some: { removedAt: null, AND: parts } } };
  return object === "COMPANY" ? onCompany : { companies: { some: { company: onCompany } } };
}

/** Membership of one segment: static → member rows, active → the segment's own filters. */
export function segmentMembershipWhere(object: CrmObject, segmentId: string, ctx: QueryContext): Where {
  const seg = ctx.segments?.get(segmentId);
  if (!seg || seg.objectType !== object) return MATCH_NOTHING;
  const depth = ctx.depth ?? 0;
  if (seg.type === "ACTIVE" && depth >= MAX_SEGMENT_DEPTH) return MATCH_NOTHING;
  const base = seg.type === "STATIC" ? { segments: { some: { segmentId } } } : (groupsWhere(object, seg.groups, { ...ctx, depth: depth + 1 }) ?? MATCH_NOTHING);
  return withExclusions(object, base, seg.exclusions, { ...ctx, depth: depth + 1 });
}

/** Leave out records of the excluded segments and the excluded records themselves. */
export function withExclusions(object: CrmObject, base: Where, ex: SegmentExclusions | null | undefined, ctx: QueryContext): Where {
  const and: Where[] = [base];
  if (ex?.records?.length) and.push({ id: { notIn: ex.records } });
  if (ex?.segments?.length && (ctx.depth ?? 0) <= MAX_SEGMENT_DEPTH) and.push({ NOT: { OR: ex.segments.map((id) => segmentMembershipWhere(object, id, ctx)) } });
  return and.length === 1 ? base : { AND: and };
}

export function conditionWhere(object: CrmObject, cond: FilterCondition, ctx: QueryContext): Where | null {
  if (isRelated(cond.association)) return relatedWhere(object, cond.association, [cond], ctx);

  if (cond.property === SEGMENT_PROPERTY) {
    const ids = arr(cond.value);
    if (!ids.length) return null;
    const any = { OR: ids.map((id) => segmentMembershipWhere(object, id, ctx)) };
    return cond.operator === "is_none_of" ? { NOT: any } : any;
  }

  // Reach across an association: contacts → company, companies → contact
  if (cond.association && cond.association !== object) {
    const target = cond.association as CrmObject;
    const inner = conditionWhere(target, { ...cond, association: undefined }, ctx);
    if (!inner) return null;
    if (object === "CONTACT" && target === "COMPANY") return { companies: { some: { company: inner } } };
    if (object === "COMPANY" && target === "CONTACT") return { contacts: { some: { contact: inner } } };
    return null;
  }

  const def = ctx.defs[object].find((d) => d.name === cond.property);
  if (!def) return null;

  if (def.isVirtual) {
    if (object === "CONTACT" && def.name === "primaryCompany") {
      if (cond.operator === "is_known") return { companies: { some: { isPrimary: true } } };
      if (cond.operator === "is_unknown") return { companies: { none: { isPrimary: true } } };
      const nameDef = ctx.defs.COMPANY.find((d) => d.name === "name")!;
      const inner = columnWhere("name", nameDef, cond, ctx, "COMPANY");
      return inner ? { companies: { some: { isPrimary: true, company: inner } } } : null;
    }
    if (object === "COMPANY" && def.name === "targetCount") {
      if (cond.operator === "is_known" || (cond.operator === "gt" && Number(cond.value) === 0)) return { contacts: { some: {} } };
      if (cond.operator === "is_unknown" || (cond.operator === "eq" && Number(cond.value) === 0)) return { contacts: { none: {} } };
      return null;
    }
    return null;
  }

  return def.isBuiltIn ? columnWhere(def.name, def, cond, ctx, object) : jsonWhere(def.name, def, cond);
}

export function searchWhere(object: CrmObject, q: string): Where | null {
  const s = q.trim();
  if (!s) return null;
  const contains = { contains: s, mode: "insensitive" };
  const digits = s.replace(/\D/g, "");
  if (object === "CONTACT") {
    const [first, ...rest] = s.split(/\s+/);
    return {
      OR: [
        { firstName: contains },
        { lastName: contains },
        { email: contains },
        { jobTitle: contains },
        ...(rest.length ? [{ AND: [{ firstName: { contains: first, mode: "insensitive" } }, { lastName: { contains: rest.join(" "), mode: "insensitive" } }] }] : []),
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { phoneNumbers: { some: { number: { contains: digits } } } }] : []),
      ],
    };
  }
  if (object === "COMPANY") {
    return {
      OR: [
        { name: contains },
        { domain: contains },
        { city: contains },
        ...(digits.length >= 3 ? [{ phone: { contains: digits } }, { phoneNumbers: { some: { number: { contains: digits } } } }] : []),
      ],
    };
  }
  return { name: contains };
}

export function buildWhere(object: CrmObject, systemKey: string | null, state: ViewState, q: string, ctx: QueryContext): Where {
  const and: Where[] = [{ deletedAt: null }];
  if (systemKey === "mine") and.push({ ownerId: ctx.userId });
  if (systemKey === "unassigned") and.push({ ownerId: null });

  for (const cond of Object.values(state.quick)) {
    const w = conditionWhere(object, cond, ctx);
    if (w) and.push(w);
  }
  const adv = groupsWhere(object, state.advanced, ctx);
  if (adv) and.push(adv);

  const s = searchWhere(object, q);
  if (s) and.push(s);
  return { AND: and };
}

/** Filter groups: groups are OR'ed together, conditions inside a group use the group's op.
 *  In AND groups, conditions on the same kind of related row (calls, signals, campaigns) are
 *  combined so they must all hold for the same row. */
export function groupsWhere(object: CrmObject, groups: FilterGroup[], ctx: QueryContext): Where | null {
  const parts = groups
    .map((g): Where | null => {
      const related = g.op === "AND" ? g.conditions.filter((c) => isRelated(c.association)) : [];
      const conds = g.conditions
        .filter((c) => !related.includes(c))
        .map((c) => conditionWhere(object, c, ctx))
        .filter((w): w is Where => !!w);
      for (const kind of RELATED_KINDS) {
        const same = related.filter((c) => c.association === kind);
        const w = same.length ? relatedWhere(object, kind, same, ctx) : null;
        if (w) conds.push(w);
      }
      if (!conds.length) return null;
      return g.op === "OR" ? { OR: conds } : { AND: conds };
    })
    .filter((w): w is Where => !!w);
  return parts.length ? { OR: parts } : null;
}

export function buildOrderBy(object: CrmObject, sort: SortSpec | null, defs: PropDef[]) {
  const dir = sort?.direction ?? "desc";
  if (sort?.property === "name") {
    return object === "CONTACT" ? [{ firstName: { sort: dir, nulls: "last" } }, { lastName: { sort: dir, nulls: "last" } }, { id: "asc" }] : [{ name: dir }, { id: "asc" }];
  }
  const def = sort ? defs.find((d) => d.name === sort.property) : null;
  if (def && def.isBuiltIn && isSortable(def)) {
    // Non-nullable columns don't accept `nulls`
    const nonNullable = ["createdAt", "crtCount", "connectedCount", "doNotCall"].includes(def.name) || (object === "COMPANY" && def.name === "name");    return [{ [def.name]: nonNullable ? dir : { sort: dir, nulls: "last" } }, { id: "asc" }];
  }
  return [{ createdAt: "desc" }, { id: "asc" }];
}

// ── Row fetching ──

export interface IndexRow {
  id: string;
  name: string;
  subtitle?: string | null;
  domain?: string | null;
  values: Record<string, unknown>;
  primaryCompany?: { id: string; name: string; domain: string | null } | null;
}

function serialize(v: unknown): unknown {
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Prisma.Decimal) return v.toNumber();
  return v;
}

function rowValues(record: Record<string, unknown>, defs: PropDef[]) {
  const values: Record<string, unknown> = {};
  const props = (record.properties ?? {}) as Record<string, unknown>;
  for (const d of defs) {
    if (d.isVirtual) continue;
    values[d.name] = serialize(d.isBuiltIn ? record[d.name] : props[d.name]);
  }
  return values;
}

const TABLES: Partial<Record<CrmObject, string>> = { CONTACT: '"Contact"', COMPANY: '"Company"' };

/** Page of ids ordered by a custom property in the `properties` jsonb (Prisma can't order by a json path). */
async function idsSortedByJson(object: CrmObject, where: Where, def: PropDef, dir: "asc" | "desc", skip: number, take: number) {
  const matching =
    object === "CONTACT"
      ? await db.contact.findMany({ where: where as Prisma.ContactWhereInput, select: { id: true } })
      : await db.company.findMany({ where: where as Prisma.CompanyWhereInput, select: { id: true } });
  if (!matching.length) return { ids: [], total: 0 };
  const key = def.name;
  const expr =
    def.type === "NUMBER"
      ? Prisma.sql`CASE WHEN jsonb_typeof(properties -> ${key}) = 'number' THEN (properties ->> ${key})::numeric END`
      : Prisma.sql`NULLIF(lower(properties ->> ${key}), '')`;
  const rows = await db.$queryRaw<{ id: string }[]>`
    SELECT id FROM ${Prisma.raw(TABLES[object]!)}
    WHERE id = ANY(${matching.map((m) => m.id)})
    ORDER BY ${expr} ${Prisma.raw(dir === "asc" ? "ASC" : "DESC")} NULLS LAST, id ASC
    OFFSET ${skip} LIMIT ${take}`;
  return { ids: rows.map((r) => r.id), total: matching.length };
}

/** Rows for an index page or export, sorted by `sort` (built-in or custom property). */
export async function fetchRows(
  object: CrmObject,
  where: Where,
  sort: SortSpec | null,
  skip: number,
  take: number,
  defs: PropDef[],
): Promise<{ rows: IndexRow[]; total: number }> {
  const def = sort ? defs.find((d) => d.name === sort.property) : null;
  if (sort && def && !def.isBuiltIn && isSortable(def)) {
    const { ids, total } = await idsSortedByJson(object, where, def, sort.direction, skip, take);
    const { rows } = await loadRows(object, { id: { in: ids } }, [{ id: "asc" }], 0, ids.length, defs);
    const pos = new Map(ids.map((id, i) => [id, i]));
    return { rows: rows.sort((a, b) => pos.get(a.id)! - pos.get(b.id)!), total };
  }
  return loadRows(object, where, buildOrderBy(object, sort, defs), skip, take, defs);
}

async function loadRows(
  object: CrmObject,
  where: Where,
  orderBy: unknown,
  skip: number,
  take: number,
  defs: PropDef[],
): Promise<{ rows: IndexRow[]; total: number }> {
  if (object === "CONTACT") {
    const w = where as Prisma.ContactWhereInput;
    const [records, total] = await Promise.all([
      db.contact.findMany({
        where: w,
        orderBy: orderBy as Prisma.ContactOrderByWithRelationInput[],
        skip,
        take,
        include: { companies: { where: { isPrimary: true }, include: { company: { select: { id: true, name: true, domain: true } } }, take: 1 } },
      }),
      db.contact.count({ where: w }),
    ]);
    return {
      total,
      rows: records.map((r) => {
        const pc = r.companies[0]?.company ?? null;
        const values = rowValues(r as unknown as Record<string, unknown>, defs);
        values.primaryCompany = pc?.name ?? null;
        return {
          id: r.id,
          name: [r.firstName, r.lastName].filter(Boolean).join(" ") || r.email || "(No name)",
          subtitle: r.jobTitle,
          values,
          primaryCompany: pc,
        };
      }),
    };
  }
  if (object === "COMPANY") {
    const w = where as Prisma.CompanyWhereInput;
    const [records, total] = await Promise.all([
      db.company.findMany({ where: w, orderBy: orderBy as Prisma.CompanyOrderByWithRelationInput[], skip, take, include: { _count: { select: { contacts: true } } } }),
      db.company.count({ where: w }),
    ]);
    return {
      total,
      rows: records.map((r) => {
        const values = rowValues(r as unknown as Record<string, unknown>, defs);
        values.targetCount = r._count.contacts;
        return { id: r.id, name: r.name, domain: r.domain, values };
      }),
    };
  }
  throw new Error(`Index not implemented for ${object}`);
}
