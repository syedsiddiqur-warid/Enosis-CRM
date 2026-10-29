// Statistics for a set of records (a segment, a list view, a draft filter): headline numbers and breakdowns by
// property, each bar carrying the filter condition that narrows the list to it. Server only.
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { STAGE } from "./journey";
import { conditionWhere, groupsWhere, segmentMembershipWhere, withExclusions, type QueryContext, type Where } from "./query";
import type { CrmObject, FilterCondition, FilterGroup, PropDef, PropOption, SegmentExclusions, UserLite } from "./types";

export interface InsightBar {
  key: string;
  label: string;
  count: number;
  color?: string;
  /** Narrows the list to this bar */
  condition: FilterCondition;
}

export interface InsightBreakdown {
  property: string;
  label: string;
  bars: InsightBar[];
  /** Records with no value */
  unknown: number;
}

export interface InsightKpi {
  key: string;
  label: string;
  value: number;
  /** Shown as "value of total (pct%)" when set */
  of?: number;
  format?: "number" | "percent" | "decimal";
  hint?: string;
  condition?: FilterCondition;
}

export interface Insights {
  object: CrmObject;
  total: number;
  database: number;
  kpis: InsightKpi[];
  breakdowns: InsightBreakdown[];
  /** Breakdowns cover at most this many records (the rest are counted in the headline numbers) */
  sampled: boolean;
}

const ROW_LIMIT = 50_000;

/** Properties broken down, in display order. Missing ones (not defined in this workspace) are skipped. */
const BREAKDOWNS: Record<"CONTACT" | "COMPANY", string[]> = {
  COMPANY: [
    "leadState",
    "industry",
    "country",
    "state",
    "timeZone",
    "employees",
    "source",
    "callStatus",
    "callable",
    "viable",
    "researchStatus",
    "gatekeeper",
    "interestLevel",
    "outsourcingExperience",
    "signalTypes",
    "technologies",
    "growthTrend",
    "offerType",
    "campaign",
    "tags",
    "ownerId",
    "callerId",
  ],
  CONTACT: ["lifecycleStage", "leadStatus", "callStatus", "seniority", "department", "country", "state", "timeZone", "inDbnd", "interestLevel", "doNotCall", "ownerId"],
};

const EMPLOYEE_BANDS: [string, number, number | null][] = [
  ["1–10", 1, 10],
  ["11–50", 11, 50],
  ["51–200", 51, 200],
  ["201–500", 201, 500],
  ["501–1,000", 501, 1000],
  ["1,001–5,000", 1001, 5000],
  ["5,001+", 5001, null],
];

const MEETING_STAGES = [STAGE.meeting, STAGE.opportunity, STAGE.customer];

function countWhere(object: CrmObject, where: Where) {
  return object === "CONTACT" ? db.contact.count({ where: where as Prisma.ContactWhereInput }) : db.company.count({ where: where as Prisma.CompanyWhereInput });
}

/** Where clause for a saved segment, or for a draft of its filters and exclusions. */
export function segmentWhere(
  object: CrmObject,
  segmentId: string,
  ctx: QueryContext,
  draft?: { groups?: FilterGroup[] | null; exclusions?: SegmentExclusions | null; type: "ACTIVE" | "STATIC" },
): Where {
  if (!draft) return { AND: [{ deletedAt: null }, segmentMembershipWhere(object, segmentId, ctx)] };
  const base = draft.type === "STATIC" ? { segments: { some: { segmentId } } } : (groupsWhere(object, draft.groups ?? [], ctx) ?? { id: { in: [] } });
  return { AND: [{ deletedAt: null }, withExclusions(object, base, draft.exclusions, ctx)] };
}

export async function computeInsights(object: CrmObject, where: Where, ctx: QueryContext, users: UserLite[]): Promise<Insights> {
  if (object !== "CONTACT" && object !== "COMPANY") throw new Error("Insights cover contacts and companies");
  const defs = ctx.defs[object];
  const defMap = new Map(defs.map((d) => [d.name, d]));
  const wanted = BREAKDOWNS[object].map((n) => defMap.get(n)).filter((d): d is PropDef => !!d && !d.isVirtual);
  const builtIns = wanted.filter((d) => d.isBuiltIn).map((d) => d.name);
  const select: Record<string, unknown> = { id: true, properties: true, crtCount: true, connectedCount: true, lastCallAt: true };
  for (const n of builtIns) select[n] = true;

  const [total, database] = await Promise.all([countWhere(object, where), countWhere(object, { deletedAt: null })]);

  const since30 = new Date(Date.now() - 30 * 864e5);
  type Row = Record<string, unknown> & { properties: Prisma.JsonValue; crtCount: number; connectedCount: number; lastCallAt: Date | null; _count?: Record<string, number> };
  const rows: Row[] =
    object === "COMPANY"
      ? ((await db.company.findMany({
          where: where as Prisma.CompanyWhereInput,
          select: { ...select, _count: { select: { contacts: true, phoneNumbers: true, campaigns: { where: { removedAt: null } } } } } as Prisma.CompanySelect,
          take: ROW_LIMIT,
        })) as unknown as Row[])
      : ((await db.contact.findMany({
          where: where as Prisma.ContactWhereInput,
          select: { ...select, email: true, phone: true, doNotCall: true, inDbnd: true, _count: { select: { phoneNumbers: true } } } as Prisma.ContactSelect,
          take: ROW_LIMIT,
        })) as unknown as Row[]);

  const value = (r: Row, d: PropDef) => (d.isBuiltIn ? r[d.name] : ((r.properties ?? {}) as Record<string, unknown>)[d.name]);

  // ── Headline numbers ──
  const n = rows.length;
  const sum = (f: (r: Row) => number) => rows.reduce((a, r) => a + f(r), 0);
  const cnt = (f: (r: Row) => boolean) => rows.reduce((a, r) => a + (f(r) ? 1 : 0), 0);
  const attempts = sum((r) => r.crtCount ?? 0);
  const connects = sum((r) => r.connectedCount ?? 0);
  const kpis: InsightKpi[] = [{ key: "total", label: object === "COMPANY" ? "Companies" : "Contacts", value: total, of: database, hint: "Share of the whole database" }];
  if (object === "COMPANY") {
    const callableDef = defMap.get("callable");
    kpis.push(
      ...(callableDef
        ? [{ key: "callable", label: "Callable", value: cnt((r) => value(r, callableDef) === "Yes"), of: n, condition: { property: "callable", operator: "is_any_of", value: ["Yes"] } } as InsightKpi]
        : []),
      { key: "targets", label: "With targets", value: cnt((r) => (r._count?.contacts ?? 0) > 0), of: n, condition: { property: "targetCount", operator: "is_known" } },
      { key: "avgTargets", label: "Targets per company", value: n ? sum((r) => r._count?.contacts ?? 0) / n : 0, format: "decimal", hint: "Average number of linked contacts" },
      { key: "phones", label: "With phone numbers", value: cnt((r) => (r._count?.phoneNumbers ?? 0) > 0), of: n },
      { key: "called", label: "Called", value: cnt((r) => r.crtCount > 0), of: n, condition: { property: "crtCount", operator: "gt", value: 0 } },
      { key: "never", label: "Never called", value: cnt((r) => !r.crtCount), of: n, condition: { property: "crtCount", operator: "eq", value: 0 } },
      { key: "recent", label: "Called in the last 30 days", value: cnt((r) => !!r.lastCallAt && r.lastCallAt >= since30), of: n, condition: { property: "lastCallAt", operator: "less_than_days_ago", value: 30 } },
      { key: "connected", label: "Reached a target", value: cnt((r) => r.connectedCount > 0), of: n, condition: { property: "connectedCount", operator: "gt", value: 0 } },
      { key: "attempts", label: "Call attempts (CRT)", value: attempts },
      { key: "connectRate", label: "Connect rate", value: attempts ? connects / attempts : 0, format: "percent", hint: "Connected calls ÷ call attempts" },
      {
        key: "meetings",
        label: "Meeting booked or further",
        value: cnt((r) => MEETING_STAGES.includes(String(r.leadState ?? "") as (typeof MEETING_STAGES)[number])),
        of: n,
        condition: { property: "leadState", operator: "is_any_of", value: [...MEETING_STAGES] },
      },
      { key: "campaigns", label: "In an active campaign", value: cnt((r) => (r._count?.campaigns ?? 0) > 0), of: n },
    );
  } else {
    kpis.push(
      { key: "email", label: "With email", value: cnt((r) => !!r.email), of: n, condition: { property: "email", operator: "is_known" } },
      { key: "phone", label: "With a phone number", value: cnt((r) => !!r.phone || (r._count?.phoneNumbers ?? 0) > 0), of: n },
      { key: "called", label: "Called", value: cnt((r) => r.crtCount > 0), of: n, condition: { property: "crtCount", operator: "gt", value: 0 } },
      { key: "connected", label: "Reached", value: cnt((r) => r.connectedCount > 0), of: n, condition: { property: "connectedCount", operator: "gt", value: 0 } },
      { key: "connectRate", label: "Connect rate", value: attempts ? connects / attempts : 0, format: "percent", hint: "Connected calls ÷ call attempts" },
      { key: "dbnd", label: "In the dial-by-name directory", value: cnt((r) => r.inDbnd === "Yes"), of: n, condition: { property: "inDbnd", operator: "is_any_of", value: ["Yes"] } },
      { key: "dnc", label: "Do not call", value: cnt((r) => r.doNotCall === true), of: n, condition: { property: "doNotCall", operator: "is", value: true } },
    );
  }

  // ── Breakdowns ──
  const optionFor = (d: PropDef, v: string): PropOption | undefined => d.options?.find((o) => o.value === v);
  const breakdowns: InsightBreakdown[] = [];
  for (const d of wanted) {
    const counts = new Map<string, number>();
    let unknown = 0;
    if (d.name === "employees") {
      for (const r of rows) {
        const e = Number(value(r, d));
        const band = Number.isFinite(e) && e > 0 ? EMPLOYEE_BANDS.find(([, a, b]) => e >= a && (b === null || e <= b)) : undefined;
        if (band) counts.set(band[0], (counts.get(band[0]) ?? 0) + 1);
        else unknown++;
      }
      const bars = EMPLOYEE_BANDS.filter(([k]) => counts.has(k)).map(([k, a, b]): InsightBar => ({
        key: k,
        label: k,
        count: counts.get(k)!,
        condition: b === null ? { property: "employees", operator: "gte", value: a } : { property: "employees", operator: "between", value: [a, b] },
      }));
      breakdowns.push({ property: d.name, label: d.label, bars, unknown });
      continue;
    }
    for (const r of rows) {
      const v = value(r, d);
      const list = Array.isArray(v) ? v.map(String) : v === null || v === undefined || v === "" ? [] : [String(v)];
      if (!list.length) unknown++;
      for (const x of list) counts.set(x, (counts.get(x) ?? 0) + 1);
    }
    if (!counts.size) continue;
    const bars = [...counts.entries()]
      .map(([k, c]): InsightBar => {
        if (d.type === "BOOLEAN") return { key: k, label: k === "true" ? "Yes" : "No", count: c, condition: { property: d.name, operator: "is", value: k === "true" } };
        const label = d.type === "USER" ? (users.find((u) => u.id === k)?.name ?? users.find((u) => u.id === k)?.email ?? "Former user") : (optionFor(d, k)?.label ?? k);
        return { key: k, label, count: c, color: optionFor(d, k)?.color, condition: { property: d.name, operator: "is_any_of", value: [k] } };
      })
      // Journey stages keep their order; everything else is largest first
      .sort((a, b) => (d.name === "leadState" ? (d.options ?? []).findIndex((o) => o.value === a.key) - (d.options ?? []).findIndex((o) => o.value === b.key) : b.count - a.count));
    breakdowns.push({ property: d.name, label: d.label, bars, unknown });
  }

  return { object, total, database, kpis, breakdowns, sampled: total > ROW_LIMIT };
}

/** Size history: one reading per segment per day (Asia/Dhaka); returns the change against the reading 7+ days ago. */
export async function recordSegmentSize(segmentId: string, size: number) {
  const day = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Dhaka" }).format(d);
  const today = day(new Date());
  await db.segmentSnapshot.upsert({ where: { segmentId_day: { segmentId, day: today } }, create: { segmentId, day: today, size }, update: { size } });
  const before = await db.segmentSnapshot.findFirst({ where: { segmentId, day: { lte: day(new Date(Date.now() - 7 * 864e5)) } }, orderBy: { day: "desc" } });
  return before ? size - before.size : null;
}

export interface MatchReport {
  matches: boolean;
  member?: boolean;
  groups: { op: "AND" | "OR"; matches: boolean; conditions: boolean[] }[];
  excludedBySegments: string[];
  excludedByHand: boolean;
}

/** Why a record is or isn't in a segment: each group and condition, and the exclusions. */
export async function explainMatch(
  object: CrmObject,
  recordId: string,
  segment: { id: string; type: "ACTIVE" | "STATIC"; groups: FilterGroup[]; exclusions: SegmentExclusions },
  ctx: QueryContext,
): Promise<MatchReport> {
  const hit = async (w: Where | null) => (w ? (await countWhere(object, { AND: [{ id: recordId }, { deletedAt: null }, w] })) > 0 : false);
  const groups =
    segment.type === "ACTIVE"
      ? await Promise.all(
          segment.groups.map(async (g) => ({
            op: g.op,
            matches: await hit(groupsWhere(object, [g], ctx)),
            conditions: await Promise.all(g.conditions.map((c) => hit(conditionWhere(object, c, ctx)))),
          })),
        )
      : [];
  const member = segment.type === "STATIC" ? await hit({ segments: { some: { segmentId: segment.id } } }) : undefined;
  const excludedBySegments: string[] = [];
  for (const id of segment.exclusions.segments) if (await hit(segmentMembershipWhere(object, id, ctx))) excludedBySegments.push(id);
  const excludedByHand = segment.exclusions.records.includes(recordId);
  const included = segment.type === "ACTIVE" ? groups.some((g) => g.matches) : !!member;
  return { matches: included && !excludedBySegments.length && !excludedByHand, member, groups, excludedBySegments, excludedByHand };
}
